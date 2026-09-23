package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"fabririo/internal/analyzer"
	"fabririo/internal/demo"
	"fabririo/internal/web"
)

type paths []string

func (p *paths) String() string     { return fmt.Sprint([]string(*p)) }
func (p *paths) Set(s string) error { *p = append(*p, s); return nil }

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
func run() error {
	var roots paths
	flag.Var(&roots, "project", "Корень Go-модуля; можно повторять для смежных проектов")
	listen := flag.String("listen", "127.0.0.1:8080", "Локальный адрес HTTP-интерфейса")
	output := flag.String("json", "", "Сохранить граф в JSON и завершить работу")
	tags := flag.String("tags", "", "Go build tags для анализа")
	maxModules := flag.Int("max-modules", 0, "Лимит уникальных Go-модулей для CLI и веб-интерфейса; 0 — без ограничения")
	maxNodes := flag.Int("max-nodes", 0, "Лимит объектов SSA; 0 — без ограничения")
	maxEdges := flag.Int("max-edges", 0, "Лимит связей SSA; 0 — без ограничения")
	flag.Parse()
	if *maxModules < 0 {
		return fmt.Errorf("max-modules должен быть неотрицательным; 0 означает отсутствие лимита")
	}
	if *maxNodes < 0 || *maxEdges < 0 {
		return fmt.Errorf("max-nodes и max-edges должны быть неотрицательными; 0 означает отсутствие лимита")
	}
	options := analyzer.Options{Roots: roots, Tags: *tags, MaxModules: *maxModules, MaxNodes: *maxNodes, MaxEdges: *maxEdges}
	// A trimpath build may have no runtime.GOROOT. Prefer the user's selected
	// toolchain, then try conventional installation directories.
	if _, err := exec.LookPath("go"); err != nil {
		directories := []string{filepath.Join(runtime.GOROOT(), "bin"), filepath.Join(os.Getenv("GOROOT"), "bin"), "/usr/local/go/bin", "/opt/homebrew/bin"}
		if runtime.GOOS == "windows" {
			directories = append(directories, filepath.Join(os.Getenv("ProgramFiles"), "Go", "bin"))
		}
		name := "go"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		for _, dir := range directories {
			if !filepath.IsAbs(dir) {
				continue
			}
			if info, e := os.Stat(filepath.Join(dir, name)); e == nil && !info.IsDir() {
				os.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
				break
			}
		}
		if _, err := exec.LookPath(name); err != nil {
			return fmt.Errorf("для анализа нужен установленный Go: добавьте его bin в PATH")
		}
	}
	demoRoots, cleanup, err := demo.Materialize()
	if err != nil {
		return err
	}
	defer cleanup()
	if len(roots) == 0 {
		roots = demoRoots
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	analysisCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	fmt.Fprintln(os.Stderr, "Fabririo · строим фабрику из Go-кода…")
	options.Roots = roots
	result, err := analyzer.Analyze(analysisCtx, options)
	cancel()
	if err != nil {
		return err
	}
	if *output != "" {
		data, err := json.MarshalIndent(result.Graph, "", "  ")
		if err != nil {
			return err
		}
		return os.WriteFile(*output, append(data, '\n'), 0644)
	}
	host, _, err := net.SplitHostPort(*listen)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("используйте локальный адрес, например 127.0.0.1:8080")
	}
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: web.New(result, demoRoots, options), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	fmt.Fprintf(os.Stderr, "Fabririo · http://%s · %d функций / %d объектов / %d маршрутов\n", listener.Addr(), len(result.Graph.Functions), len(result.Graph.Nodes), len(result.Graph.Edges))
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	err = server.Serve(listener)
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
