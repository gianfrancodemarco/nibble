package protocol

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/santhosh-tekuri/jsonschema/v6/kind"
)

// Kinds are the visual kinds protocol v1 defines.
var Kinds = []string{"map", "sequence", "timeline", "compare"}

// schemaFS embeds the visual JSON Schemas. The canonical copies live at
// protocol/schemas/ in the repository; TestSchemasInSync keeps the two
// byte-identical.
//
//go:embed schemas/*.schema.json
var schemaFS embed.FS

var (
	schemasOnce sync.Once
	schemas     map[string]*jsonschema.Schema
	schemasErr  error
)

// loadSchemas compiles every embedded schema once.
func loadSchemas() (map[string]*jsonschema.Schema, error) {
	schemasOnce.Do(func() {
		c := jsonschema.NewCompiler()
		out := make(map[string]*jsonschema.Schema, len(Kinds))
		for _, kind := range Kinds {
			name := "schemas/" + kind + ".schema.json"
			raw, err := schemaFS.ReadFile(name)
			if err != nil {
				schemasErr = err
				return
			}
			doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
			if err != nil {
				schemasErr = fmt.Errorf("%s: %w", name, err)
				return
			}
			url := "https://raw.githubusercontent.com/gianfrancodemarco/nibble/main/protocol/schemas/" + kind + ".schema.json"
			if err := c.AddResource(url, doc); err != nil {
				schemasErr = err
				return
			}
			s, err := c.Compile(url)
			if err != nil {
				schemasErr = err
				return
			}
			out[kind] = s
		}
		schemas = out
	})
	return schemas, schemasErr
}

// maxMapNodes is the structural budget the protocol owns (opinion 5's other
// budgets are enforced by the CLI, not here).
const maxMapNodes = 12

// ValidateVisual validates a raw visual document: schema pass (shape, enums,
// unknown-field rejection) then semantic pass (dangling ids, budgets, state
// uniqueness, side mismatch). Errors carry protocol error codes.
func ValidateVisual(raw []byte) error {
	var env struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return errf(CodeVisualSchema, "not a JSON object: %v", err)
	}
	all, err := loadSchemas()
	if err != nil {
		return err
	}
	schema, ok := all[env.Kind]
	if !ok {
		return errf(CodeVisualKindUnknown, "kind %q is not a v1 visual; want one of %s", env.Kind, strings.Join(Kinds, ", "))
	}

	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return errf(CodeVisualSchema, "invalid JSON: %v", err)
	}
	if err := schema.Validate(doc); err != nil {
		if verr, ok := err.(*jsonschema.ValidationError); ok {
			if names := findUnknownFields(verr); len(names) > 0 {
				return errf(CodeVisualFieldUnknown, "unknown field(s) %s: agents describe what things are, never how they look", strings.Join(names, ", "))
			}
			if hasLevelViolation(verr) {
				return errf(CodeVisualLevelUnknown, "level must be %q (the only v1 level; %q is reserved, and overview is the default — just omit the field)", "standard", "deep")
			}
			return errf(CodeVisualSchema, "%v", verr)
		}
		return errf(CodeVisualSchema, "%v", err)
	}

	switch env.Kind {
	case "map":
		return validateMap(raw)
	case "sequence":
		return validateSequence(raw)
	case "timeline":
		return validateTimeline(raw)
	case "compare":
		return validateCompare(raw)
	}
	return nil
}

// hasLevelViolation walks a validation error tree looking for a failure at a
// `level` property — in v1 that is always a bad enum value.
func hasLevelViolation(v *jsonschema.ValidationError) bool {
	loc := v.InstanceLocation
	if len(loc) > 0 && loc[len(loc)-1] == "level" {
		return true
	}
	for _, c := range v.Causes {
		if hasLevelViolation(c) {
			return true
		}
	}
	return false
}

// findUnknownFields walks a validation error tree looking for
// additionalProperties violations and returns the offending field names.
func findUnknownFields(v *jsonschema.ValidationError) []string {
	var names []string
	if k, ok := v.ErrorKind.(*kind.AdditionalProperties); ok {
		names = append(names, k.Properties...)
	}
	for _, c := range v.Causes {
		names = append(names, findUnknownFields(c)...)
	}
	return names
}

type mapDoc struct {
	Nodes []struct {
		ID    string `json:"id"`
		Label string `json:"label"`
		Level string `json:"level"`
	} `json:"nodes"`
	Edges []struct {
		From  string `json:"from"`
		To    string `json:"to"`
		Level string `json:"level"`
	} `json:"edges"`
}

func validateMap(raw []byte) error {
	var d mapDoc
	if err := json.Unmarshal(raw, &d); err != nil {
		return errf(CodeVisualSchema, "%v", err)
	}
	if len(d.Nodes) > maxMapNodes {
		return errf(CodeMapNodesBudget, "map has %d nodes (max %d): split the plate into chapters or collapse a group", len(d.Nodes), maxMapNodes)
	}
	ids := map[string]bool{}
	standardOnly := map[string]bool{}
	allStandard := true
	for _, n := range d.Nodes {
		if ids[n.ID] {
			return errf(CodeMapNodeDuplicate, "node id %q declared twice", n.ID)
		}
		ids[n.ID] = true
		if n.Level == "standard" {
			standardOnly[n.ID] = true
		} else {
			allStandard = false
		}
	}
	for _, e := range d.Edges {
		if !ids[e.From] {
			return errf(CodeMapEdgeDangling, "edge from %q: no such node", e.From)
		}
		if !ids[e.To] {
			return errf(CodeMapEdgeDangling, "edge to %q: no such node", e.To)
		}
		if e.Level != "standard" {
			if standardOnly[e.From] {
				return errf(CodeMapEdgeLevel, "overview edge from %q: that node is standard-only; mark the edge level standard or unlevel the node", e.From)
			}
			if standardOnly[e.To] {
				return errf(CodeMapEdgeLevel, "overview edge to %q: that node is standard-only; mark the edge level standard or unlevel the node", e.To)
			}
		}
	}
	if allStandard {
		return errf(CodeVisualOverviewEmpty, "every node is standard-only, so the overview would draw nothing: leave the core of the picture unlevelled")
	}
	return nil
}

type sequenceDoc struct {
	Actors []struct {
		ID string `json:"id"`
	} `json:"actors"`
	Steps []struct {
		ID    string `json:"id"`
		From  string `json:"from"`
		To    string `json:"to"`
		Level string `json:"level"`
	} `json:"steps"`
}

func validateSequence(raw []byte) error {
	var d sequenceDoc
	if err := json.Unmarshal(raw, &d); err != nil {
		return errf(CodeVisualSchema, "%v", err)
	}
	ids := map[string]bool{}
	for _, a := range d.Actors {
		ids[a.ID] = true
	}
	allStandard := true
	for _, s := range d.Steps {
		if !ids[s.From] {
			return errf(CodeSequenceStepDangling, "step from %q: no such actor", s.From)
		}
		if !ids[s.To] {
			return errf(CodeSequenceStepDangling, "step to %q: no such actor", s.To)
		}
		if s.Level != "standard" {
			allStandard = false
		}
	}
	if allStandard {
		return errf(CodeVisualOverviewEmpty, "every step is standard-only, so the overview would draw bare lifelines: leave the key steps unlevelled")
	}
	return nil
}

type timelineEvent struct {
	ID    string `json:"id"`
	Lane  string `json:"lane"`
	Level string `json:"level"`
}

type timelineDoc struct {
	Lanes []struct {
		ID    string `json:"id"`
		Level string `json:"level"`
	} `json:"lanes"`
	Events []timelineEvent `json:"events"`
	States []struct {
		Name    string          `json:"name"`
		Default bool            `json:"default"`
		Events  []timelineEvent `json:"events"`
	} `json:"states"`
}

func validateTimeline(raw []byte) error {
	var d timelineDoc
	if err := json.Unmarshal(raw, &d); err != nil {
		return errf(CodeVisualSchema, "%v", err)
	}
	lanes := map[string]bool{}
	standardOnly := map[string]bool{}
	allStandard := true
	for _, l := range d.Lanes {
		lanes[l.ID] = true
		if l.Level == "standard" {
			standardOnly[l.ID] = true
		} else {
			allStandard = false
		}
	}
	checkEvents := func(events []timelineEvent, where string) error {
		for _, e := range events {
			if !lanes[e.Lane] {
				return errf(CodeTimelineEventDangling, "%s: event in lane %q: no such lane", where, e.Lane)
			}
			if e.Level != "standard" && standardOnly[e.Lane] {
				return errf(CodeTimelineEventLevel, "%s: overview event in lane %q: that lane is standard-only; mark the event level standard or unlevel the lane", where, e.Lane)
			}
			if e.Level != "standard" {
				allStandard = false
			}
		}
		return nil
	}
	if err := checkEvents(d.Events, "events"); err != nil {
		return err
	}
	names := map[string]bool{}
	defaults := 0
	for _, s := range d.States {
		if names[s.Name] {
			return errf(CodeTimelineStateDuplicate, "state %q declared twice", s.Name)
		}
		names[s.Name] = true
		if s.Default {
			defaults++
		}
		if err := checkEvents(s.Events, "state "+s.Name); err != nil {
			return err
		}
	}
	if defaults > 1 {
		return errf(CodeTimelineStateDefault, "%d states marked default, at most one may be", defaults)
	}
	if allStandard {
		return errf(CodeVisualOverviewEmpty, "every lane and event is standard-only, so the overview would draw nothing: leave the core of the picture unlevelled")
	}
	return nil
}

type compareDoc struct {
	Before compareSide `json:"before"`
	After  compareSide `json:"after"`
}

type compareSide struct {
	Content map[string]json.RawMessage `json:"content"`
}

func (s compareSide) contentType() string {
	for _, k := range []string{"ref", "map", "metrics"} {
		if _, ok := s.Content[k]; ok {
			return k
		}
	}
	return ""
}

func validateCompare(raw []byte) error {
	var d compareDoc
	if err := json.Unmarshal(raw, &d); err != nil {
		return errf(CodeVisualSchema, "%v", err)
	}
	b, a := d.Before.contentType(), d.After.contentType()
	if b != a {
		return errf(CodeCompareSidesMismatch, "before holds %s, after holds %s: both sides must hold the same content type", b, a)
	}
	return nil
}

// CollectAnchors returns every stable element id in a valid visual document:
// what a ref's @anchor or a reader comment may point at.
func CollectAnchors(raw []byte) []string {
	var env struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil
	}
	var out []string
	switch env.Kind {
	case "map":
		var d mapDoc
		if json.Unmarshal(raw, &d) == nil {
			for _, n := range d.Nodes {
				out = append(out, n.ID)
			}
		}
	case "sequence":
		var d sequenceDoc
		if json.Unmarshal(raw, &d) == nil {
			for _, a := range d.Actors {
				out = append(out, a.ID)
			}
			for _, s := range d.Steps {
				if s.ID != "" {
					out = append(out, s.ID)
				}
			}
		}
	case "timeline":
		var d timelineDoc
		if json.Unmarshal(raw, &d) == nil {
			for _, l := range d.Lanes {
				out = append(out, l.ID)
			}
			for _, e := range d.Events {
				if e.ID != "" {
					out = append(out, e.ID)
				}
			}
			for _, s := range d.States {
				out = append(out, s.Name)
				for _, e := range s.Events {
					if e.ID != "" {
						out = append(out, e.ID)
					}
				}
			}
		}
	case "compare":
		out = append(out, "before", "after")
	}
	return out
}
