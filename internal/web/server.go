package web

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"fabririo/internal/analyzer"
	"fabririo/internal/graph"
)

type Server struct {
	mu     sync.RWMutex
	result *graph.Result
	demo   []string
	busy   chan struct{}
	limits analyzer.Options
}

func New(initial *graph.Result, demoRoots []string, limits analyzer.Options) http.Handler {
	s := &Server{result: initial, demo: demoRoots, busy: make(chan struct{}, 1), limits: limits}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/graph", func(w http.ResponseWriter, r *http.Request) {
		s.mu.RLock()
		defer s.mu.RUnlock()
		writeJSON(w, 200, s.result.Graph)
	})
	mux.HandleFunc("GET /api/source", s.source)
	mux.HandleFunc("GET /api/snapshot", func(w http.ResponseWriter, r *http.Request) {
		s.mu.RLock()
		defer s.mu.RUnlock()
		if revision := r.URL.Query().Get("revision"); revision != "" && revision != s.result.Graph.Revision {
			apiError(w, 409, fmt.Errorf("фабрика обновлена в другой вкладке; повторите загрузку"))
			return
		}
		writeJSON(w, 200, struct {
			Graph   *graph.Graph      `json:"graph"`
			Sources map[string]string `json:"sources"`
		}{s.result.Graph, s.result.Sources})
	})
	mux.HandleFunc("POST /api/analyze", s.analyze)
	static, _ := fs.Sub(assets, "static")
	mux.Handle("/", http.FileServerFS(static))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
		host := r.Host
		if h, _, e := net.SplitHostPort(host); e == nil {
			host = h
		}
		ip := net.ParseIP(host)
		if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			http.Error(w, "loopback host required", 403)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, e := url.Parse(origin)
			if e != nil || u.Host != r.Host || u.Scheme != "http" {
				http.Error(w, "same origin required", 403)
				return
			}
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "same origin required", 403)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func apiError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (s *Server) source(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if revision := r.URL.Query().Get("revision"); revision != "" && revision != s.result.Graph.Revision {
		apiError(w, 409, fmt.Errorf("фабрика обновлена в другой вкладке; обновите страницу, чтобы открыть соответствующий исходник"))
		return
	}
	id := r.URL.Query().Get("id")
	source, ok := s.result.Sources[id]
	if !ok {
		apiError(w, 404, fmt.Errorf("исходник отсутствует в текущем снимке"))
		return
	}
	writeJSON(w, 200, map[string]string{"path": s.result.Graph.Files[id], "content": source})
}

func (s *Server) analyze(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		apiError(w, 415, fmt.Errorf("ожидается application/json"))
		return
	}
	select {
	case s.busy <- struct{}{}:
		defer func() { <-s.busy }()
	default:
		apiError(w, 409, fmt.Errorf("анализ уже выполняется"))
		return
	}
	var request struct {
		Roots []string `json:"roots"`
		Tags  string   `json:"tags"`
		Demo  bool     `json:"demo"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536))
	decoder.DisallowUnknownFields()
	if e := decoder.Decode(&request); e != nil {
		apiError(w, 400, e)
		return
	}
	if request.Demo {
		request.Roots = s.demo
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	result, e := analyzer.Analyze(ctx, analyzer.Options{Roots: request.Roots, Tags: request.Tags, MaxModules: s.limits.MaxModules, MaxNodes: s.limits.MaxNodes, MaxEdges: s.limits.MaxEdges})
	if e != nil {
		apiError(w, 422, e)
		return
	}
	s.mu.Lock()
	s.result = result
	s.mu.Unlock()
	writeJSON(w, 200, result.Graph)
}
