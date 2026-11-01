package protocol

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// TrustLevel says how much a stored ref can be trusted against the code as it
// is now.
type TrustLevel string

const (
	TrustExact   TrustLevel = "exact"
	TrustShifted TrustLevel = "shifted"
	TrustStale   TrustLevel = "stale"
)

// contextWidth is how many lines on each side of a referenced range fp1
// captures to disambiguate shifted matches.
const contextWidth = 2

// Fingerprint is the fp1 record stored with a ref at write time. It holds no
// source text, only hashes, so plates can travel without leaking code beyond
// what the agent quoted.
type Fingerprint struct {
	Sum       string   `json:"fp"`         // "fp1:<sha256 hex>" over the normalized referenced lines
	Lines     []string `json:"lines"`      // per-line hashes of the referenced range
	CtxBefore []string `json:"ctx_before"` // hashes of up to contextWidth lines above
	CtxAfter  []string `json:"ctx_after"`  // hashes of up to contextWidth lines below
}

// normalizeLine applies fp1 normalization: trailing whitespace is stripped.
// (CRLF→LF is handled by SplitLines before lines reach the fingerprint.)
func normalizeLine(s string) string {
	return strings.TrimRight(s, " \t\r")
}

func hashLine(s string) string {
	sum := sha256.Sum256([]byte(normalizeLine(s)))
	return hex.EncodeToString(sum[:])
}

// NewFingerprint fingerprints lines start..end (1-based, inclusive) of f.
func NewFingerprint(f *FileContent, start, end int) (*Fingerprint, error) {
	n := len(f.Lines)
	if start < 1 || end < start {
		return nil, errf(CodeRefRange, "invalid range %d-%d", start, end)
	}
	if end > n {
		return nil, errf(CodeRefBeyondEOF, "file has %d lines, range ends at %d", n, end)
	}

	var norm []string
	fp := &Fingerprint{}
	for i := start; i <= end; i++ {
		line := f.Lines[i-1]
		norm = append(norm, normalizeLine(line))
		fp.Lines = append(fp.Lines, hashLine(line))
	}
	sum := sha256.Sum256([]byte(strings.Join(norm, "\n")))
	fp.Sum = "fp1:" + hex.EncodeToString(sum[:])

	for i := max(1, start-contextWidth); i < start; i++ {
		fp.CtxBefore = append(fp.CtxBefore, hashLine(f.Lines[i-1]))
	}
	for i := end + 1; i <= min(n, end+contextWidth); i++ {
		fp.CtxAfter = append(fp.CtxAfter, hashLine(f.Lines[i-1]))
	}
	return fp, nil
}

// Trust computes how much a fingerprint taken at originalStart can be trusted
// against the file as it is now. A nil current file means the file is gone.
// For TrustShifted, offset is the signed line displacement; otherwise 0.
//
// Rules (see protocol/PROTOCOL.md): exact when the content still matches at
// the original position; shifted when it is found whole at exactly one other
// position (stored context breaks ties among several); stale otherwise.
func (fp *Fingerprint) Trust(originalStart int, current *FileContent) (TrustLevel, int) {
	if current == nil {
		return TrustStale, 0
	}
	cur := make([]string, len(current.Lines))
	for i, l := range current.Lines {
		cur[i] = hashLine(l)
	}

	w := len(fp.Lines)
	var positions []int // 1-based start positions where the content matches
	for pos := 1; pos+w-1 <= len(cur); pos++ {
		match := true
		for j := 0; j < w; j++ {
			if cur[pos-1+j] != fp.Lines[j] {
				match = false
				break
			}
		}
		if match {
			positions = append(positions, pos)
		}
	}

	for _, p := range positions {
		if p == originalStart {
			return TrustExact, 0
		}
	}
	if len(positions) == 1 {
		return TrustShifted, positions[0] - originalStart
	}
	if len(positions) > 1 {
		var withCtx []int
		for _, p := range positions {
			if fp.contextMatches(cur, p, w) {
				withCtx = append(withCtx, p)
			}
		}
		if len(withCtx) == 1 {
			return TrustShifted, withCtx[0] - originalStart
		}
	}
	return TrustStale, 0
}

// contextMatches reports whether every stored context line hash is present
// adjacent to a candidate match at pos.
func (fp *Fingerprint) contextMatches(cur []string, pos, w int) bool {
	nb := len(fp.CtxBefore)
	if pos-1-nb < 0 {
		return false
	}
	for j := 0; j < nb; j++ {
		if cur[pos-1-nb+j] != fp.CtxBefore[j] {
			return false
		}
	}
	na := len(fp.CtxAfter)
	if pos-1+w+na > len(cur) {
		return false
	}
	for j := 0; j < na; j++ {
		if cur[pos-1+w+j] != fp.CtxAfter[j] {
			return false
		}
	}
	return true
}
