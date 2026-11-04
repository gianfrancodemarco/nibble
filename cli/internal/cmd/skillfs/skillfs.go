// Package skillfs embeds the agent skill packages the CLI installs with
// `nibble setup`. The canonical source is the repo's top-level skill/
// directory; this committed mirror exists because go:embed cannot reach
// above the module. CI fails when the two diverge.
package skillfs

import "embed"

// FS holds one directory per agent (claude-code/...).
//
//go:embed all:claude-code
var FS embed.FS
