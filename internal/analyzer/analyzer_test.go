package analyzer

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"fabririo/internal/demo"
	"fabririo/internal/graph"
)

func toolchain(t *testing.T) {
	t.Helper()
	t.Setenv("PATH", filepath.Join(runtime.GOROOT(), "bin")+string(os.PathListSeparator)+os.Getenv("PATH"))
}
func module(t *testing.T, name, source string) string {
	t.Helper()
	dir := t.TempDir()
	writeTest(t, filepath.Join(dir, "go.mod"), "module "+name+"\n\ngo 1.24.0\n")
	writeTest(t, filepath.Join(dir, "main.go"), source)
	return dir
}
func writeTest(t *testing.T, path, data string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
}
func analyzeTest(t *testing.T, roots ...string) *graph.Result {
	t.Helper()
	toolchain(t)
	result, err := Analyze(context.Background(), Options{Roots: roots})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestConfigurableModuleLimit(t *testing.T) {
	toolchain(t)
	roots := make([]string, 33)
	for i := range roots {
		roots[i] = module(t, fmt.Sprintf("test.local/limit%d", i), "package sample\nfunc Value() int { return 1 }\n")
	}
	for _, test := range []struct {
		name      string
		limit     int
		errorText string
	}{
		{"unlimited", 0, ""},
		{"exact boundary", 33, ""},
		{"raised limit", 64, ""},
		{"over limit", 32, "лимит 32 модулей"},
		{"negative limit", -1, "неотрицательным"},
	} {
		t.Run(test.name, func(t *testing.T) {
			result, err := Analyze(context.Background(), Options{Roots: roots, MaxModules: test.limit})
			if test.errorText != "" {
				if err == nil || !strings.Contains(err.Error(), test.errorText) {
					t.Fatalf("expected %q, got %v", test.errorText, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Graph.Projects) != len(roots) {
				t.Fatalf("lost modules: got %d, want %d", len(result.Graph.Projects), len(roots))
			}
		})
	}
}

func TestLargeSingleModuleBeyondFormerNodeLimit(t *testing.T) {
	var source strings.Builder
	source.WriteString("package sample\n")
	for i := 0; i < 300; i++ {
		fmt.Fprintf(&source, "func F%d(x, step int) int {\n", i)
		for j := 0; j < 40; j++ {
			source.WriteString("x += step\n")
		}
		source.WriteString("return x\n}\n")
	}
	root := module(t, "test.local/large", source.String())
	result := analyzeTest(t, root)
	if len(result.Graph.Nodes) <= 20000 {
		t.Fatalf("fixture did not exceed old limit: %d", len(result.Graph.Nodes))
	}
	if len(result.Graph.Functions) != 301 {
		t.Fatalf("functions were truncated: %d", len(result.Graph.Functions))
	}
	if len(result.Sources) != 1 {
		t.Fatalf("source snapshot missing: %d", len(result.Sources))
	}
}

func TestConfigurableGraphLimits(t *testing.T) {
	toolchain(t)
	root := module(t, "test.local/graphlimits", "package sample\nfunc Sum(x, y int) int { z := x+y; return z*2 }\n")
	base := analyzeTest(t, root).Graph
	for _, tt := range []struct {
		name         string
		nodes, edges int
		diagnostic   string
	}{
		{"unlimited", 0, 0, ""},
		{"exact boundary", len(base.Nodes), len(base.Edges), ""},
		{"node rejection", len(base.Nodes) - 1, 0, "-max-nodes=0"},
		{"edge rejection", 0, len(base.Edges) - 1, "-max-edges=0"},
		{"negative nodes", -1, 0, "неотрицательными"},
		{"negative edges", 0, -1, "неотрицательными"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			result, err := Analyze(context.Background(), Options{Roots: []string{root}, MaxNodes: tt.nodes, MaxEdges: tt.edges})
			if tt.diagnostic != "" {
				if err == nil || !strings.Contains(err.Error(), tt.diagnostic) {
					t.Fatalf("expected %q, got %v", tt.diagnostic, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Graph.Nodes) != len(base.Nodes) || len(result.Graph.Edges) != len(base.Edges) {
				t.Fatal("limits changed the graph")
			}
		})
	}
}

func TestModuleLimitCountsUniqueRoots(t *testing.T) {
	toolchain(t)
	root := module(t, "test.local/unique", "package sample\nfunc Value() int { return 1 }\n")
	roots := make([]string, 40)
	for i := range roots {
		roots[i] = root
	}
	check := func(t *testing.T) {
		t.Helper()
		result, err := Analyze(context.Background(), Options{Roots: roots, MaxModules: 1})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Graph.Projects) != 1 {
			t.Fatalf("same module counted more than once: %d", len(result.Graph.Projects))
		}
	}
	t.Run("repeated paths", check)
	t.Run("symlink alias", func(t *testing.T) {
		alias := filepath.Join(t.TempDir(), "alias")
		if err := os.Symlink(root, alias); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}
		roots = append(roots, alias)
		check(t)
	})
}
func countEdges(g *graph.Graph, kind string) int {
	count := 0
	for _, e := range g.Edges {
		if e.Kind == kind {
			count++
		}
	}
	return count
}

func TestDemoCrossModuleAndSinks(t *testing.T) {
	roots, cleanup, err := demo.Materialize()
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	result := analyzeTest(t, roots...)
	g := result.Graph
	if len(g.Projects) != 2 || len(g.Functions) != 9 {
		t.Fatalf("projects=%d funcs=%d", len(g.Projects), len(g.Functions))
	}
	protocols := map[string]int{}
	nodes := map[string]*graph.Node{}
	for _, n := range g.Nodes {
		if nodes[n.ID] != nil {
			t.Fatalf("duplicate ID %s", n.ID)
		}
		nodes[n.ID] = n
		if n.Kind == "rocket" || n.Kind == "warehouse" {
			protocols[n.Protocol]++
		}
		if n.Source.File != "" {
			if _, ok := result.Sources[n.Source.File]; !ok {
				t.Fatalf("missing source %s", n.Source.File)
			}
		}
	}
	for _, p := range []string{"http", "grpc", "webrtc", "websocket", "sql"} {
		if protocols[p] != 1 {
			t.Errorf("protocol %s: got %d", p, protocols[p])
		}
	}
	if countEdges(g, "train") != 1 {
		t.Errorf("expected exactly one channel route, got %d", countEdges(g, "train"))
	}
	cross := false
	for _, e := range g.Edges {
		if nodes[e.From] == nil || nodes[e.To] == nil {
			t.Fatalf("dangling edge: %+v", e)
		}
		if e.Kind == "call" && nodes[e.From].Package != nodes[e.To].Package {
			cross = true
		}
	}
	if !cross {
		t.Error("missing cross-module argument conveyor")
	}
	if countEdges(g, "disposal") == 0 {
		t.Error("missing end-of-use trash")
	}
	for _, root := range roots {
		if _, err := os.Stat(filepath.Join(root, "go.work")); !os.IsNotExist(err) {
			t.Error("analyzer wrote go.work into input")
		}
		if _, err := os.Stat(filepath.Join(root, "go.sum")); !os.IsNotExist(err) {
			t.Error("analyzer wrote go.sum into input")
		}
	}
}

func TestChannelsAreResolvedByIdentityNotNames(t *testing.T) {
	dir := module(t, "test.local/channels", `package channels
func send(queue chan<- int, value int) { queue <- value }
func first() int { queue := make(chan int, 1); go send(queue, 1); return <-queue }
func second() int { queue := make(chan int, 1); queue <- 2; return <-queue }
func choose(queue chan int) int { select { case v := <-queue: return v; default: return 0 } }
func third() int { queue := make(chan int, 1); queue <- 3; return choose(queue) }
`)
	g := analyzeTest(t, dir).Graph
	if got := countEdges(g, "train"); got != 3 {
		t.Fatalf("want 3 distinct routes, got %d", got)
	}
	byID := map[string]*graph.Node{}
	for _, n := range g.Nodes {
		byID[n.ID] = n
	}
	for _, e := range g.Edges {
		if e.Kind == "train" && strings.HasSuffix(byID[e.From].Function, "second") && !strings.HasSuffix(byID[e.To].Function, "second") {
			t.Errorf("unrelated queue merged: %+v", e)
		}
	}
}

func TestClosureAndReturnedChannels(t *testing.T) {
	dir := module(t, "test.local/closures", `package closures
func factory() chan int { return make(chan int, 1) }
func Run() int { queue := factory(); go func() { queue <- 7 }(); return <-queue }
`)
	g := analyzeTest(t, dir).Graph
	if got := countEdges(g, "train"); got != 1 {
		t.Fatalf("closure capture / returned channel lost: %d", got)
	}
}

func TestPhiGenericsShadowingAndDelete(t *testing.T) {
	dir := module(t, "test.local/values", `package values
func Identity[T any](v T) T { return v }
func Run(x int, b bool) int {
 y := Identity(x)
 if b { y = y + 1 } else { y = y - 1 }
 cache := map[int]int{y: x}; delete(cache,y)
 { x := y * 2; y = x + 1 }
 for i:=0;i<3;i++ { y += i }
 return y
}
`)
	g := analyzeTest(t, dir).Graph
	phi, trash := 0, 0
	for _, n := range g.Nodes {
		if n.Kind == "splitter" && strings.HasPrefix(n.Label, "Слияние") {
			phi++
		}
		if n.Kind == "trash" && strings.HasPrefix(n.Label, "delete") {
			trash++
		}
	}
	if phi < 2 || trash != 1 {
		t.Errorf("phi=%d delete=%d", phi, trash)
	}
	if countEdges(g, "call") == 0 || countEdges(g, "return") == 0 {
		t.Error("generic argument/return edges missing")
	}
}

func TestNoGuessFromVariableNames(t *testing.T) {
	dir := module(t, "test.local/names", `package names
type Local struct{}
func (*Local) Send(v string) {}
func (*Local) Exec(v string) {}
func Run(db, websocket, http *Local) { db.Exec("x"); websocket.Send("y"); http.Send("z") }
`)
	g := analyzeTest(t, dir).Graph
	for _, n := range g.Nodes {
		if n.Kind == "warehouse" || n.Kind == "rocket" {
			t.Errorf("false sink from name: %+v", n)
		}
	}
}

func TestBrokenInputAndBuildTags(t *testing.T) {
	toolchain(t)
	dir := module(t, "test.local/tags", "package tags\nfunc OK() int { return 1 }\n")
	writeTest(t, filepath.Join(dir, "extra.go"), "//go:build extra\n\npackage tags\nfunc Extra() int { return 2 }\n")
	result, err := Analyze(context.Background(), Options{Roots: []string{dir}, Tags: "extra"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Graph.Functions) != 3 {
		t.Errorf("build tags not respected: %d", len(result.Graph.Functions))
	}
	writeTest(t, filepath.Join(dir, "main.go"), "package tags\nfunc Broken() { missing() }\n")
	if _, err = Analyze(context.Background(), Options{Roots: []string{dir}}); err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("type error not surfaced: %v", err)
	}
	if _, err = Analyze(context.Background(), Options{Roots: []string{t.TempDir()}}); err == nil {
		t.Error("missing module accepted")
	}
}

func TestStableGraphAndCancellation(t *testing.T) {
	dir := module(t, "test.local/stable", "package stable\nfunc F(x int) int { y:=x+1; return y*2 }\n")
	a := analyzeTest(t, dir)
	b := analyzeTest(t, dir)
	first, _ := json.Marshal(a.Graph)
	second, _ := json.Marshal(b.Graph)
	if string(first) != string(second) {
		t.Error("graph IDs or ordering are not deterministic")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Analyze(ctx, Options{Roots: []string{dir}}); err == nil {
		t.Error("cancellation ignored")
	}
}

func TestGlobalChannelAndPrivateMethod(t *testing.T) {
	dir := module(t, "test.local/global", `package global
var queue = make(chan string, 1)
func Send() { queue <- "cargo" }
func Receive() string { return <-queue }
type hidden struct{}
func (*hidden) unused(x int) int { return x+1 }
`)
	g := analyzeTest(t, dir).Graph
	if countEdges(g, "train") != 1 {
		t.Error("global channel initialization not linked")
	}
	found := false
	for _, f := range g.Functions {
		if strings.Contains(f.Name, "unused") {
			found = true
		}
	}
	if !found {
		t.Error("unreferenced private method missing")
	}
}

func TestSQLReturningWrites(t *testing.T) {
	dir := module(t, "test.local/sqlwrite", `package sqlwrite
import "database/sql"
func Write(db *sql.DB) *sql.Row { return db.QueryRow("INSERT INTO parcels VALUES (1) RETURNING id") }
func Read(db *sql.DB) *sql.Row { return db.QueryRow("SELECT id FROM parcels") }
`)
	g := analyzeTest(t, dir).Graph
	warehouses := 0
	for _, n := range g.Nodes {
		if n.Kind == "warehouse" {
			warehouses++
			if strings.HasSuffix(n.Function, "Read") {
				t.Error("read query treated as warehouse write")
			}
		}
	}
	if warehouses != 1 {
		t.Errorf("expected one SQL write, got %d", warehouses)
	}
}

func TestMethodColorIdentity(t *testing.T) {
	root := module(t, "test.local/colors", `package sample

type Store struct{}
type Cache struct{}
type Writer interface { Save(string) }
func (Store) Save(string) {}
func (Cache) Save(string) {}
func First(s Store, w Writer, value string) int {
  s.Save(value)
  go s.Save(value)
  defer s.Save(value)
  w.Save(value)
  Cache{}.Save(value)
  return len(value)
}
func Second(s Store, value string) { s.Save(value) }
`)
	result := analyzeTest(t, root)
	counts := map[string]int{}
	for _, n := range result.Graph.Nodes {
		if n.Method != "" && (n.Function == "test.local/colors.First" || n.Function == "test.local/colors.Second") {
			counts[n.Method]++
		}
	}
	for method, want := range map[string]int{
		"(test.local/colors.Store).Save": 4,
		"(test.local/colors.Cache).Save": 1,
		"test.local/colors.Writer.Save":  1,
		"builtin.len":                    1,
	} {
		if counts[method] != want {
			t.Errorf("method %q: got %d calls, want %d; identities: %v", method, counts[method], want, counts)
		}
	}
}
