package protocol

import "fmt"

// Error codes are the stable, machine-readable part of the protocol's error
// contract. Messages may change; codes may not. Every code must be documented
// in protocol/PROTOCOL.md (enforced by TestErrorCodeIndex).
const (
	CodeRefSyntax          = "ref.syntax"
	CodeRefRange           = "ref.range"
	CodeRefPath            = "ref.path"
	CodeRefFileMissing     = "ref.file.missing"
	CodeRefBeyondEOF       = "ref.range.beyond-eof"
	CodeRefDiffSideMissing = "ref.diff.side-missing"

	CodeVisualKindUnknown   = "visual.kind.unknown"
	CodeVisualFieldUnknown  = "visual.field.unknown"
	CodeVisualSchema        = "visual.schema"
	CodeVisualLevelUnknown  = "visual.level.unknown"
	CodeVisualOverviewEmpty = "visual.overview.empty"

	CodeMapNodeDuplicate       = "map.node.duplicate"
	CodeMapRingUnknown         = "map.ring.unknown"
	CodeMapRingPartial         = "map.ring.partial"
	CodeMapRingEmpty           = "map.ring.empty"
	CodeMapEdgeDangling        = "map.edge.dangling"
	CodeMapEdgeLevel           = "map.edge.level"
	CodeMapNodesBudget         = "map.nodes.budget"
	CodeSequenceStepDangling   = "sequence.step.dangling"
	CodeTimelineEventDangling  = "timeline.event.dangling"
	CodeTimelineEventLevel     = "timeline.event.level"
	CodeTimelineStateDuplicate = "timeline.state.duplicate"
	CodeTimelineStateDefault   = "timeline.state.default"
	CodeCompareSidesMismatch   = "compare.sides.mismatch"

	CodePlateVersionMissing     = "plate.version.missing"
	CodePlateVersionUnsupported = "plate.version.unsupported"
	CodePlateNibblesGap         = "plate.nibbles.gap"
	CodePlateSealed             = "plate.sealed"
	CodePlateHeader             = "plate.header"
	CodePlateDescription        = "plate.description"
	CodeNibbleVisualMissing     = "nibble.visual.missing"
	CodeNibbleTitleMissing      = "nibble.title.missing"
	CodeNibbleDescription       = "nibble.description"
	CodeNibbleFile              = "nibble.file"
	CodeReviewVerdictUnknown    = "review.verdict.unknown"
	CodeReviewExists            = "review.exists"
	CodeRefAnchorDangling       = "ref.anchor.dangling"
	CodeRefFPInvalid            = "ref.fp.invalid"
)

// Error is a protocol validation error with a stable code.
type Error struct {
	Code string
	Msg  string
}

func (e *Error) Error() string { return e.Code + ": " + e.Msg }

func errf(code, format string, a ...any) *Error {
	return &Error{Code: code, Msg: fmt.Sprintf(format, a...)}
}

// ErrCode returns the protocol error code of err, or "" if err is nil or not
// a protocol error.
func ErrCode(err error) string {
	if err == nil {
		return ""
	}
	if pe, ok := err.(*Error); ok {
		return pe.Code
	}
	return ""
}
