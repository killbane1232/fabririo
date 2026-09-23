// Package analyzer turns typed Go SSA into a static factory data-flow graph.
package analyzer

import (
	"context"
	"crypto/sha256"
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"fabririo/internal/graph"
	"golang.org/x/mod/modfile"
	"golang.org/x/mod/semver"
	"golang.org/x/tools/go/packages"
	"golang.org/x/tools/go/ssa"
	"golang.org/x/tools/go/ssa/ssautil"
)

type Options struct {
	Roots []string
	Tags  string
	// MaxModules limits distinct module roots after resolving symlinks.
	// Zero means unlimited; negative values are invalid.
	MaxModules int
	// Optional graph-size limits. Zero keeps the full graph.
	MaxNodes int
	MaxEdges int
}

// Analyze loads only local modules. It never runs the analyzed program, downloads
// dependencies, or edits its go.mod/go.sum/go.work. Dependencies must be cached.
func Analyze(ctx context.Context, options Options) (result *graph.Result, err error) {
	defer func() {
		if problem := recover(); problem != nil {
			result = nil
			err = fmt.Errorf("SSA: %v", problem)
		}
	}()
	if len(options.Roots) == 0 {
		return nil, fmt.Errorf("укажите хотя бы одну папку с go.mod")
	}
	if options.MaxModules < 0 {
		return nil, fmt.Errorf("max-modules должен быть неотрицательным; 0 означает отсутствие лимита")
	}
	if options.MaxNodes < 0 || options.MaxEdges < 0 {
		return nil, fmt.Errorf("max-nodes и max-edges должны быть неотрицательными; 0 означает отсутствие лимита")
	}
	var projects []graph.Project
	version := "1.18.0"
	seen := map[string]bool{}
	for _, root := range options.Roots {
		abs, e := filepath.Abs(strings.TrimSpace(root))
		if e != nil {
			return nil, e
		}
		abs, e = filepath.EvalSymlinks(abs)
		if e != nil {
			return nil, fmt.Errorf("папка %s: %w", root, e)
		}
		if seen[abs] {
			continue
		}
		if options.MaxModules > 0 && len(projects) >= options.MaxModules {
			return nil, fmt.Errorf("превышен лимит %d модулей: увеличьте -max-modules или задайте -max-modules=0 для отключения лимита", options.MaxModules)
		}
		seen[abs] = true
		data, e := os.ReadFile(filepath.Join(abs, "go.mod"))
		if e != nil {
			return nil, fmt.Errorf("в %s не найден go.mod: выберите корень Go-модуля", abs)
		}
		mf, e := modfile.Parse("go.mod", data, nil)
		if e != nil {
			return nil, e
		}
		if mf.Module == nil {
			return nil, fmt.Errorf("в %s/go.mod отсутствует module", abs)
		}
		if mf.Go != nil && semver.Compare("v"+mf.Go.Version, "v"+version) > 0 {
			version = mf.Go.Version
		}
		for _, p := range projects {
			if p.Module == mf.Module.Mod.Path {
				return nil, fmt.Errorf("два проекта объявляют один module %s", p.Module)
			}
		}
		projects = append(projects, graph.Project{Path: abs, Module: mf.Module.Mod.Path})
	}
	sort.Slice(projects, func(i, j int) bool { return projects[i].Module < projects[j].Module })
	temp, e := os.MkdirTemp("", "fabririo-work-*")
	if e != nil {
		return nil, e
	}
	defer os.RemoveAll(temp)
	work := "go " + version + "\n\nuse (\n"
	var patterns []string
	for _, p := range projects {
		work += "\t" + strconv.Quote(p.Path) + "\n"
		patterns = append(patterns, filepath.Join(p.Path, "..."))
	}
	work += ")\n"
	workPath := filepath.Join(temp, "go.work")
	if e := os.WriteFile(workPath, []byte(work), 0600); e != nil {
		return nil, e
	}
	env := os.Environ()
	// Explicit values override any inherited package driver or mod-writing flags.
	env = append(env, "GOWORK="+workPath, "GOPROXY=off", "GOSUMDB=off", "GOTOOLCHAIN=local", "GOPACKAGESDRIVER=off", "GOFLAGS=-mod=readonly")
	config := &packages.Config{Context: ctx, Mode: packages.LoadSyntax, Dir: projects[0].Path, Env: env, Fset: token.NewFileSet()}
	if options.Tags != "" {
		config.BuildFlags = []string{"-tags=" + options.Tags}
	}
	pkgs, e := packages.Load(config, patterns...)
	if e != nil {
		return nil, fmt.Errorf("загрузка Go-пакетов: %w", e)
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	var errors []string
	packages.Visit(pkgs, nil, func(p *packages.Package) {
		for _, e := range p.Errors {
			if len(errors) < 15 {
				errors = append(errors, e.Error())
			}
		}
	})
	if len(errors) > 0 {
		return nil, fmt.Errorf("Go-проект не прошёл загрузку типов. Проверьте сборку и выполните go mod download в своих проектах, затем повторите анализ.\n%s", strings.Join(errors, "\n"))
	}
	if len(pkgs) == 0 {
		return nil, fmt.Errorf("в выбранных проектах нет Go-пакетов для текущей платформы и build tags")
	}
	prog, ssaPkgs := ssautil.Packages(pkgs, ssa.GlobalDebug|ssa.InstantiateGenerics)
	// Sequential package builds allow panic recovery at this boundary.
	for _, p := range ssaPkgs {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if p != nil {
			p.Build()
		}
	}
	b := newBuilder(prog, projects)
	b.maxNodes, b.maxEdges = options.MaxNodes, options.MaxEdges
	for _, p := range pkgs {
		for _, f := range p.Syntax {
			filename := config.Fset.Position(f.Pos()).Filename
			id := b.fileID(filename)
			data, e := os.ReadFile(filename)
			if e == nil && len(data) <= 2<<20 {
				b.sources[id] = string(data)
			}
			for _, decl := range f.Decls {
				fd, ok := decl.(*ast.FuncDecl)
				if !ok || fd.Doc == nil {
					continue
				}
				for _, c := range fd.Doc.List {
					annotation := strings.TrimSpace(strings.TrimPrefix(c.Text, "//"))
					if strings.HasPrefix(annotation, "fabririo:") {
						words := strings.Fields(strings.TrimPrefix(annotation, "fabririo:"))
						if len(words) > 0 && (words[0] == "rocket" || words[0] == "warehouse" || words[0] == "trash") {
							b.annotations[fd.Name.Pos()] = words
						}
					}
				}
			}
		}
	}
	all := ssautil.AllFunctions(prog)
	// AllFunctions intentionally omits some unreachable private methods. An
	// explorer must include source declarations even when nothing calls them.
	for _, p := range pkgs {
		for _, obj := range p.TypesInfo.Defs {
			if fn, ok := obj.(*types.Func); ok {
				if f := prog.FuncValue(fn); f != nil {
					all[f] = true
				}
			}
		}
	}
	for i, p := range ssaPkgs {
		if p == nil || len(pkgs[i].Syntax) == 0 {
			continue
		}
		if f := p.Func("init"); f != nil && len(f.Blocks) > 0 {
			all[f] = true
			b.positions[f] = pkgs[i].Syntax[0].Pos()
		}
	}
	var funcs []*ssa.Function
	for f := range all {
		if len(f.Blocks) == 0 || functionPackage(f) == nil {
			continue
		}
		position := f.Pos()
		if !position.IsValid() {
			position = b.positions[f]
		}
		pos := prog.Fset.Position(position)
		if pos.Filename == "" {
			continue
		}
		if b.projectFor(pos.Filename) != "" {
			funcs = append(funcs, f)
		}
	}
	sort.Slice(funcs, func(i, j int) bool {
		a, c := funcs[i], funcs[j]
		if a.String() == c.String() {
			return a.Pos() < c.Pos()
		}
		return a.String() < c.String()
	})
	if len(funcs) == 0 {
		return nil, fmt.Errorf("нет функций с телами для визуализации")
	}
	if err := b.build(ctx, funcs); err != nil {
		return nil, err
	}
	checksum := sha256.New()
	fileIDs := make([]string, 0, len(b.sources))
	for id := range b.sources {
		fileIDs = append(fileIDs, id)
	}
	sort.Strings(fileIDs)
	for _, id := range fileIDs {
		fmt.Fprintf(checksum, "%s\x00%s\x00%s\x00", id, b.g.Files[id], b.sources[id])
	}
	b.g.Revision = fmt.Sprintf("%x", checksum.Sum(nil))[:20]
	return &graph.Result{Graph: b.g, Sources: b.sources}, nil
}
