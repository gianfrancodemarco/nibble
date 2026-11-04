// Package skill holds the agent skill packages the CLI installs with
// `nibble setup`, one directory per agent (claude-code/...). The content
// ships inside the binary; the installed copy in a consuming repo is always
// written by `setup`, never by hand.
package skill

import "embed"

// FS holds one directory per agent (claude-code/...).
//
//go:embed all:claude-code
var FS embed.FS
