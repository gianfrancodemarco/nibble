// Command nibble is the agent-facing CLI of the nibble protocol.
package main

import (
	"os"

	"github.com/gianfrancodemarco/nibble/cli/internal/cmd"
)

func main() {
	os.Exit(cmd.Main(os.Args[1:], os.Stdout, os.Stderr))
}
