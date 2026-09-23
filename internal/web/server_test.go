package web

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"fabririo/internal/analyzer"
	"fabririo/internal/graph"
)

func TestHTTPModuleLimit(t *testing.T) {
	t.Setenv("PATH", filepath.Join(runtime.GOROOT(), "bin")+string(os.PathListSeparator)+os.Getenv("PATH"))
	roots := make([]string, 33)
	for i := range roots {
		roots[i] = t.TempDir()
		for name, content := range map[string]string{
			"go.mod":  fmt.Sprintf("module test.local/http%d\n\ngo 1.24.0\n", i),
			"main.go": "package sample\nfunc Value() int { return 1 }\n",
		} {
			if err := os.WriteFile(filepath.Join(roots[i], name), []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	body, err := json.Marshal(map[string]any{"roots": roots})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name          string
		limit, status int
	}{
		{"unlimited", 0, http.StatusOK},
		{"configured rejection", 32, http.StatusUnprocessableEntity},
		{"raised limit", 64, http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			h := New(&graph.Result{Graph: &graph.Graph{Version: 1}}, nil, analyzer.Options{MaxModules: test.limit})
			r := httptest.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader(body))
			r.Host = "localhost:8080"
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != test.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if w.Code == http.StatusOK {
				var g graph.Graph
				if err := json.Unmarshal(w.Body.Bytes(), &g); err != nil {
					t.Fatal(err)
				}
				if len(g.Projects) != len(roots) {
					t.Fatalf("got %d modules, want %d", len(g.Projects), len(roots))
				}
			} else if !strings.Contains(w.Body.String(), "лимит 32 модулей") {
				t.Fatalf("wrong diagnostic: %s", w.Body.String())
			}
		})
	}
}

func TestServerSnapshotAndGuards(t *testing.T) {
	h := New(&graph.Result{Graph: &graph.Graph{Version: 1}, Sources: map[string]string{"f1": "package test"}}, nil, analyzer.Options{})
	tests := []struct {
		name, method, path, host, origin, contentType, body string
		status                                              int
	}{
		{"portable snapshot", "GET", "/api/snapshot", "localhost:8080", "", "", "", 200},
		{"stale portable snapshot", "GET", "/api/snapshot?revision=old", "localhost:8080", "", "", "", 409},
		{"cross origin snapshot", "GET", "/api/snapshot", "localhost:8080", "https://example.com", "", "", 403},
		{"graph", "GET", "/api/graph", "127.0.0.1:8080", "", "", "", 200},
		{"source snapshot", "GET", "/api/source?id=f1", "localhost:8080", "", "", "", 200},
		{"path traversal", "GET", "/api/source?id=../../etc/passwd", "localhost:8080", "", "", "", 404},
		{"stale source revision", "GET", "/api/source?id=f1&revision=previous", "localhost:8080", "", "", "", 409},
		{"host rebinding", "GET", "/api/graph", "attacker.example:8080", "", "", "", 403},
		{"cross origin", "POST", "/api/analyze", "localhost:8080", "https://attacker.example", "application/json", "{}", 403},
		{"simple form", "POST", "/api/analyze", "localhost:8080", "", "text/plain", "{}", 415},
		{"malformed JSON", "POST", "/api/analyze", "localhost:8080", "", "application/json", "{", 400},
		{"missing root", "POST", "/api/analyze", "localhost:8080", "", "application/json", "{}", 422},
		{"assets", "GET", "/world.js", "localhost:8080", "", "", "", 200},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
			r.Host = test.host
			r.Header.Set("Origin", test.origin)
			r.Header.Set("Content-Type", test.contentType)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != test.status {
				t.Errorf("status=%d body=%s", w.Code, w.Body.String())
			}
			if test.name == "portable snapshot" {
				var snapshot struct {
					Graph   graph.Graph       `json:"graph"`
					Sources map[string]string `json:"sources"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &snapshot); err != nil || snapshot.Graph.Version != 1 || snapshot.Sources["f1"] != "package test" {
					t.Fatal("portable snapshot lost graph or sources")
				}
			}
			if test.name == "source snapshot" && !strings.Contains(w.Body.String(), "package test") {
				t.Error("source missing")
			}
		})
	}
	// A failed analysis must preserve the previous valid snapshot.
	r := httptest.NewRequest(http.MethodGet, "/api/source?id=f1", nil)
	r.Host = "localhost:8080"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Error("snapshot discarded after failed analysis")
	}
}

func TestHTTPGraphLimitsAndSnapshot(t *testing.T) {
	t.Setenv("PATH", filepath.Join(runtime.GOROOT(), "bin")+string(os.PathListSeparator)+os.Getenv("PATH"))
	root := t.TempDir()
	for name, content := range map[string]string{"go.mod": "module test.local/websize\n\ngo 1.24.0\n", "main.go": "package sample\nfunc Sum(x,y int) int { z:=x+y; return z*2 }\n"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	body, _ := json.Marshal(map[string]any{"roots": []string{root}})
	for _, limits := range []analyzer.Options{{MaxNodes: 1}, {MaxEdges: 1}, {}} {
		h := New(&graph.Result{Graph: &graph.Graph{Version: 1}, Sources: map[string]string{"old": "previous snapshot"}}, nil, limits)
		r := httptest.NewRequest("POST", "/api/analyze", bytes.NewReader(body))
		r.Host = "localhost:8080"
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if limits.MaxNodes == 0 && limits.MaxEdges == 0 {
			if w.Code != 200 {
				t.Fatal(w.Body.String())
			}
			continue
		}
		if w.Code != 422 || !strings.Contains(w.Body.String(), "-max-") {
			t.Fatalf("missing size diagnostic: %d %s", w.Code, w.Body.String())
		}
		r = httptest.NewRequest("GET", "/api/source?id=old", nil)
		r.Host = "localhost:8080"
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || !strings.Contains(w.Body.String(), "previous snapshot") {
			t.Fatal("failed analysis discarded previous source")
		}
	}
}
