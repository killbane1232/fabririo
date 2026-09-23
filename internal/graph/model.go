// Package graph defines the portable factory model shared by the analyzer and UI.
package graph

type Location struct {
	File string `json:"file"`
	Line int    `json:"line"`
}

type Node struct {
	ID       string   `json:"id"`
	Kind     string   `json:"kind"`
	Label    string   `json:"label"`
	Detail   string   `json:"detail"`
	Function string   `json:"function"`
	Method   string   `json:"method,omitempty"`
	Package  string   `json:"package"`
	Block    int      `json:"block"`
	Order    int      `json:"order"`
	Type     string   `json:"type,omitempty"`
	Names    []string `json:"names,omitempty"`
	Protocol string   `json:"protocol,omitempty"`
	Reason   string   `json:"reason,omitempty"`
	Helper   bool     `json:"helper,omitempty"`
	Source   Location `json:"source"`
}

type Edge struct {
	ID    string `json:"id"`
	From  string `json:"from"`
	To    string `json:"to"`
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Type  string `json:"type,omitempty"`
}

type Function struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Package string   `json:"package"`
	Project string   `json:"project"`
	Source  Location `json:"source"`
}

type Project struct {
	Path   string `json:"path"`
	Module string `json:"module"`
}

type Graph struct {
	Version   int               `json:"version"`
	Revision  string            `json:"revision"`
	Mode      string            `json:"mode"`
	Projects  []Project         `json:"projects"`
	Functions []Function        `json:"functions"`
	Nodes     []*Node           `json:"nodes"`
	Edges     []Edge            `json:"edges"`
	Warnings  []string          `json:"warnings"`
	Files     map[string]string `json:"files"`
}

type Result struct {
	Graph *Graph
	// Sources is a snapshot of the analyzed files; the server never accepts a disk path.
	Sources map[string]string
}
