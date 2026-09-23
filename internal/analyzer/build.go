package analyzer

import (
	"context"
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"path/filepath"
	"sort"
	"strings"

	"fabririo/internal/graph"
	"golang.org/x/tools/go/ssa"
)

type endpoint struct {
	channel ssa.Value
	node    string
	value   ssa.Value
}
type memoryWrite struct {
	address ssa.Value
	value   ssa.Value
	node    string
}
type memoryRead struct {
	address ssa.Value
	value   ssa.Value
	node    string
}

type builder struct {
	prog               *ssa.Program
	g                  *graph.Graph
	sources            map[string]string
	fileIDs            map[string]string
	annotations        map[token.Pos][]string
	nodes              map[ssa.Value]*graph.Node
	instructions       map[ssa.Instruction]*graph.Node
	functions          map[*ssa.Function]string
	positions          map[*ssa.Function]token.Pos
	names              map[ssa.Value][]string
	parents            map[ssa.Value]ssa.Value
	sends, receives    []endpoint
	writes             []memoryWrite
	reads              []memoryRead
	uniqueEdges        map[string]bool
	escaped            map[ssa.Value]bool
	maxNodes, maxEdges int
}

func newBuilder(prog *ssa.Program, projects []graph.Project) *builder {
	return &builder{prog: prog, g: &graph.Graph{Version: 1, Mode: "static-ssa", Projects: projects, Functions: []graph.Function{}, Nodes: []*graph.Node{}, Edges: []graph.Edge{}, Files: map[string]string{}, Warnings: []string{
		"Анимация показывает возможные потоки SSA, а не реальное выполнение: скорость, количество грузов и расписание поездов условны.",
		"Мусорки означают завершение использования значения или delete. Они не показывают фактическую работу сборщика мусора Go.",
		"Вызовы через интерфейсы и указатели на функции, alias-анализ памяти и каналов внутри контейнеров разрешаются не полностью. Ветви и циклы показаны как возможные пути.",
	}}, sources: map[string]string{}, fileIDs: map[string]string{}, annotations: map[token.Pos][]string{}, nodes: map[ssa.Value]*graph.Node{}, instructions: map[ssa.Instruction]*graph.Node{}, functions: map[*ssa.Function]string{}, positions: map[*ssa.Function]token.Pos{}, names: map[ssa.Value][]string{}, parents: map[ssa.Value]ssa.Value{}, uniqueEdges: map[string]bool{}, escaped: map[ssa.Value]bool{}}
}

func (b *builder) projectFor(file string) string {
	for _, p := range b.g.Projects {
		rel, e := filepath.Rel(p.Path, file)
		if e == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return p.Module
		}
	}
	return ""
}
func (b *builder) fileID(file string) string {
	if file == "" {
		return ""
	}
	if id := b.fileIDs[file]; id != "" {
		return id
	}
	id := fmt.Sprintf("f%d", len(b.fileIDs)+1)
	b.fileIDs[file] = id
	b.g.Files[id] = file
	return id
}
func (b *builder) location(pos token.Pos, f *ssa.Function) graph.Location {
	p := b.prog.Fset.Position(pos)
	if (!pos.IsValid() || b.projectFor(p.Filename) == "") && f != nil {
		pos = f.Pos()
		if !pos.IsValid() {
			pos = b.positions[f]
		}
		p = b.prog.Fset.Position(pos)
	}
	return graph.Location{File: b.fileID(p.Filename), Line: p.Line}
}
func (b *builder) add(n *graph.Node) *graph.Node {
	n.ID = fmt.Sprintf("n%d", len(b.g.Nodes)+1)
	b.g.Nodes = append(b.g.Nodes, n)
	return n
}
func (b *builder) edge(from, to, kind, label, typ string) {
	if from == "" || to == "" || from == to {
		return
	}
	key := from + "|" + to + "|" + kind + "|" + label
	if b.uniqueEdges[key] {
		return
	}
	b.uniqueEdges[key] = true
	b.g.Edges = append(b.g.Edges, graph.Edge{ID: fmt.Sprintf("e%d", len(b.g.Edges)+1), From: from, To: to, Kind: kind, Label: label, Type: typ})
}
func typeName(v ssa.Value) string {
	if v == nil || v.Type() == nil {
		return ""
	}
	return types.TypeString(v.Type(), func(p *types.Package) string { return p.Name() })
}
func functionPackage(f *ssa.Function) *types.Package {
	if f.Pkg != nil {
		return f.Pkg.Pkg
	}
	if obj := f.Object(); obj != nil && obj.Pkg() != nil {
		return obj.Pkg()
	}
	if origin := f.Origin(); origin != nil && origin != f {
		return functionPackage(origin)
	}
	if parent := f.Parent(); parent != nil {
		return functionPackage(parent)
	}
	return nil
}
func (b *builder) label(v ssa.Value) string {
	if len(b.names[v]) > 0 {
		return strings.Join(b.names[v], ", ")
	}
	return v.Name()
}
func (b *builder) value(v ssa.Value, f *ssa.Function) *graph.Node {
	if v == nil {
		return nil
	}
	if n := b.nodes[v]; n != nil {
		return n
	}
	switch v.(type) {
	case *ssa.Function, *ssa.Builtin:
		return nil
	}
	kind := "source"
	detail := v.String()
	helper := false
	switch v.(type) {
	case *ssa.Const:
		helper = len(b.names[v]) == 0
	case *ssa.Global:
		kind = "memory"
	}
	n := b.add(&graph.Node{Kind: kind, Label: b.label(v), Detail: detail, Function: b.functions[f], Package: functionPackage(f).Path(), Order: -1, Type: typeName(v), Names: b.names[v], Helper: helper, Source: b.location(v.Pos(), f)})
	b.nodes[v] = n
	return n
}
func addName(list []string, name string) []string {
	for _, x := range list {
		if x == name {
			return list
		}
	}
	return append(list, name)
}

func (b *builder) build(ctx context.Context, funcs []*ssa.Function) error {
	for _, f := range funcs {
		id := f.String()
		b.functions[f] = id
		location := b.location(f.Pos(), f)
		b.g.Functions = append(b.g.Functions, graph.Function{ID: id, Name: f.RelString(functionPackage(f)), Package: functionPackage(f).Path(), Project: b.projectFor(b.g.Files[location.File]), Source: location})
		for _, param := range f.Params {
			b.names[param] = []string{param.Name()}
		}
		for _, free := range f.FreeVars {
			b.names[free] = []string{free.Name()}
		}
		for _, block := range f.Blocks {
			for _, instr := range block.Instrs {
				if ref, ok := instr.(*ssa.DebugRef); ok && ref.X != nil {
					if ident, ok := ref.Expr.(*ast.Ident); ok && ident.Name != "_" {
						b.names[ref.X] = addName(b.names[ref.X], ident.Name)
					}
				}
			}
		}
	}
	for _, f := range funcs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		for _, p := range f.Params {
			b.value(p, f)
		}
		for _, v := range f.FreeVars {
			b.value(v, f)
		}
		order := 0
		for _, block := range f.Blocks {
			for _, instr := range block.Instrs {
				if ref, ok := instr.(*ssa.DebugRef); ok {
					b.value(ref.X, f)
					continue
				}
				switch instr.(type) {
				case *ssa.Jump, *ssa.RunDefers:
					continue
				}
				n := b.instruction(instr, f, block.Index, order)
				order++
				b.instructions[instr] = n
				if v, ok := instr.(ssa.Value); ok {
					if prior := b.nodes[v]; prior != nil { // A debug reference can precede its phi instruction.
						oldID := prior.ID
						*prior = *n
						prior.ID = oldID
						b.g.Nodes = b.g.Nodes[:len(b.g.Nodes)-1]
						n = prior
						b.instructions[instr] = n
					}
					b.nodes[v] = n
				}
			}
		}
		if err := b.checkLimits(); err != nil {
			return err
		}
	}
	for _, f := range funcs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		for _, block := range f.Blocks {
			for _, instr := range block.Instrs {
				n := b.instructions[instr]
				if n == nil {
					continue
				}
				for _, operand := range instr.Operands(nil) {
					if operand == nil || *operand == nil {
						continue
					}
					v := *operand
					source := b.value(v, f)
					if source != nil {
						b.edge(source.ID, n.ID, "belt", b.label(v), typeName(v))
					}
				}
				switch in := instr.(type) {
				case *ssa.Send:
					b.sends = append(b.sends, endpoint{in.Chan, n.ID, in.X})
					b.escaped[in.X] = true
				case *ssa.UnOp:
					if in.Op == token.ARROW {
						b.receives = append(b.receives, endpoint{in.X, n.ID, nil})
					}
					if in.Op == token.MUL {
						b.reads = append(b.reads, memoryRead{in.X, in, n.ID})
					}
				case *ssa.Select:
					for _, state := range in.States {
						if state.Dir == types.SendOnly {
							b.sends = append(b.sends, endpoint{state.Chan, n.ID, state.Send})
							b.escaped[state.Send] = true
						} else {
							b.receives = append(b.receives, endpoint{state.Chan, n.ID, nil})
						}
					}
				case *ssa.Store:
					b.writes = append(b.writes, memoryWrite{in.Addr, in.Val, n.ID})
					b.escaped[in.Val] = true
				case *ssa.MapUpdate:
					b.escaped[in.Value] = true
				case *ssa.Return:
					for _, v := range in.Results {
						b.escaped[v] = true
					}
				case *ssa.Phi:
					if isChannel(in) {
						for _, v := range in.Edges {
							b.union(in, v)
						}
					}
				case *ssa.ChangeType:
					if isChannel(in) {
						b.union(in, in.X)
					}
				case *ssa.MakeClosure:
					if target, ok := in.Fn.(*ssa.Function); ok {
						for i, v := range in.Bindings {
							if i < len(target.FreeVars) {
								b.union(v, target.FreeVars[i])
								if dst := b.nodes[target.FreeVars[i]]; dst != nil {
									if src := b.value(v, f); src != nil {
										b.edge(src.ID, dst.ID, "call", b.label(v), typeName(v))
									}
								}
							}
						}
					}
				}
				if call, ok := instr.(ssa.CallInstruction); ok {
					b.connectCall(call, n, f)
				}
			}
		}
		if err := b.checkLimits(); err != nil {
			return err
		}
	}
	// Address-specific memory edges preserve separate fields and separate channels.
	// Stores from alternative branches are intentionally conservative possibilities.
	writeIndex := map[string][]memoryWrite{}
	for _, w := range b.writes {
		key := b.addressKey(w.address)
		writeIndex[key] = append(writeIndex[key], w)
	}
	for _, r := range b.reads {
		for _, w := range writeIndex[b.addressKey(r.address)] {
			b.union(w.value, r.value)
			b.edge(w.node, r.node, "memory", "память", typeName(w.value))
		}
	}
	for _, send := range b.sends {
		for _, recv := range b.receives {
			if b.root(send.channel) == b.root(recv.channel) {
				b.edge(send.node, recv.node, "train", b.label(send.channel), typeName(send.value))
			}
		}
	}
	b.addTrash(funcs)
	if err := b.checkLimits(); err != nil {
		return err
	}
	for _, n := range b.g.Nodes {
		if len(n.Names) > 0 {
			n.Helper = false
		}
	}
	return nil
}

func (b *builder) checkLimits() error {
	if b.maxNodes > 0 && len(b.g.Nodes) > b.maxNodes {
		return fmt.Errorf("граф содержит %d объектов, лимит %d: увеличьте -max-nodes или задайте -max-nodes=0", len(b.g.Nodes), b.maxNodes)
	}
	if b.maxEdges > 0 && len(b.g.Edges) > b.maxEdges {
		return fmt.Errorf("граф содержит %d связей, лимит %d: увеличьте -max-edges или задайте -max-edges=0", len(b.g.Edges), b.maxEdges)
	}
	return nil
}

func (b *builder) instruction(instr ssa.Instruction, f *ssa.Function, block, order int) *graph.Node {
	n := &graph.Node{Kind: "machine", Label: "Обработка", Detail: instr.String(), Function: b.functions[f], Package: functionPackage(f).Path(), Block: block, Order: order, Source: b.location(instr.Pos(), f)}
	if v, ok := instr.(ssa.Value); ok {
		n.Type = typeName(v)
		n.Names = b.names[v]
		if len(n.Names) > 0 {
			n.Label = strings.Join(n.Names, ", ")
		}
	}
	switch in := instr.(type) {
	case *ssa.Alloc:
		n.Label = "Выделение памяти"
		n.Helper = true
	case *ssa.BinOp:
		n.Label = in.Op.String()
		if len(n.Names) > 0 {
			n.Label = strings.Join(n.Names, ", ") + " · " + in.Op.String()
		}
	case *ssa.UnOp:
		if in.Op == token.ARROW {
			n.Kind = "station"
			n.Label = "Получить · " + b.label(in.X)
		} else {
			n.Helper = true
		}
	case *ssa.MakeChan:
		n.Kind = "station"
		n.Label = "Канал · " + b.label(in)
	case *ssa.Send:
		n.Kind = "station"
		n.Label = "Отправить · " + b.label(in.Chan)
	case *ssa.Select:
		n.Kind = "station"
		n.Label = "Развязка select"
	case *ssa.Phi:
		n.Kind = "splitter"
		n.Label = "Слияние · " + b.label(in)
	case *ssa.If:
		n.Kind = "splitter"
		n.Label = "Условие"
	case *ssa.Return:
		n.Kind = "output"
		n.Label = "Возврат"
	case *ssa.Store:
		n.Kind = "memory"
		n.Label = "Запись в память"
		n.Helper = true
	case *ssa.MapUpdate:
		n.Kind = "memory"
		n.Label = "Запись в map"
	case *ssa.Panic:
		n.Kind = "trash"
		n.Label = "panic"
		n.Reason = "Аварийное завершение пути исполнения"
	case *ssa.Extract, *ssa.FieldAddr, *ssa.IndexAddr, *ssa.ChangeType, *ssa.ChangeInterface, *ssa.Convert, *ssa.MakeInterface, *ssa.Slice:
		n.Helper = true
	}
	if call, ok := instr.(ssa.CallInstruction); ok {
		kind, protocol, reason, label := b.classify(call.Common())
		// Keep the called method separate from the containing workshop and the
		// display label (which may include go/defer). Colors use this identity.
		common := call.Common()
		switch {
		case common.StaticCallee() != nil:
			n.Method = common.StaticCallee().String()
		case common.IsInvoke():
			n.Method = types.TypeString(common.Value.Type(), func(p *types.Package) string { return p.Path() }) + "." + common.Method.Name()
		default:
			if builtin, ok := common.Value.(*ssa.Builtin); ok {
				n.Method = "builtin." + builtin.Name()
			}
		}
		n.Kind = kind
		n.Protocol = protocol
		n.Reason = reason
		n.Label = label
		switch instr.(type) {
		case *ssa.Go:
			n.Label = "go · " + label
		case *ssa.Defer:
			n.Label = "defer · " + label
		}
	}
	return b.add(n)
}

func (b *builder) connectCall(call ssa.CallInstruction, n *graph.Node, caller *ssa.Function) {
	common := call.Common()
	target := common.StaticCallee()
	for _, v := range common.Args {
		b.escaped[v] = true
	}
	if target == nil || b.functions[target] == "" {
		return
	}
	for i, arg := range common.Args {
		if i >= len(target.Params) {
			break
		}
		param := target.Params[i]
		b.union(arg, param)
		if src, dst := b.value(arg, caller), b.nodes[param]; src != nil && dst != nil {
			b.edge(src.ID, dst.ID, "call", b.label(arg)+" → "+param.Name(), typeName(arg))
		}
	}
	if len(target.Params) == 0 {
		for _, block := range target.Blocks {
			for _, in := range block.Instrs {
				if dst := b.instructions[in]; dst != nil {
					b.edge(n.ID, dst.ID, "call", "вызов", "")
					goto linked
				}
			}
		}
	}
linked:
	// A goroutine or deferred call has no synchronous return value.
	value := call.Value()
	if value == nil {
		return
	}
	for _, block := range target.Blocks {
		for _, instr := range block.Instrs {
			if ret, ok := instr.(*ssa.Return); ok {
				if len(ret.Results) > 0 {
					b.edge(b.instructions[ret].ID, n.ID, "return", "результат", typeName(value))
				}
				if len(ret.Results) == 1 {
					b.union(ret.Results[0], value)
				} else {
					if refs := value.Referrers(); refs != nil {
						for _, ref := range *refs {
							if extract, ok := ref.(*ssa.Extract); ok && extract.Index < len(ret.Results) {
								b.union(ret.Results[extract.Index], extract)
							}
						}
					}
				}
			}
		}
	}
}

func isChannel(v ssa.Value) bool {
	if v == nil {
		return false
	}
	_, ok := v.Type().Underlying().(*types.Chan)
	return ok
}
func (b *builder) root(v ssa.Value) ssa.Value {
	if p, ok := b.parents[v]; ok && p != v {
		b.parents[v] = b.root(p)
		return b.parents[v]
	}
	return v
}
func aliasable(v ssa.Value) bool {
	if v == nil {
		return false
	}
	switch v.Type().Underlying().(type) {
	case *types.Chan, *types.Pointer:
		return true
	}
	return false
}
func (b *builder) union(a, c ssa.Value) {
	if !aliasable(a) || !aliasable(c) {
		return
	}
	a = b.root(a)
	c = b.root(c)
	if a != c {
		b.parents[c] = a
	}
}
func (b *builder) addressKey(v ssa.Value) string {
	v = b.root(v)
	switch x := v.(type) {
	case *ssa.FieldAddr:
		return b.addressKey(x.X) + fmt.Sprintf(".field%d", x.Field)
	case *ssa.IndexAddr:
		if c, ok := x.Index.(*ssa.Const); ok {
			return b.addressKey(x.X) + "[" + c.Name() + "]"
		}
	}
	return fmt.Sprintf("%p", v)
}

func (b *builder) addTrash(funcs []*ssa.Function) {
	// SSA has no runtime free instruction. These terminals explicitly represent
	// the end of use for non-escaping named scalar values, never an observed GC.
	byFunction := map[string][]ssa.Value{}
	for v, n := range b.nodes {
		if len(n.Names) > 0 && !b.escaped[v] && !isChannel(v) {
			byFunction[n.Function] = append(byFunction[n.Function], v)
		}
	}
	for _, f := range funcs {
		values := byFunction[b.functions[f]]
		sort.Slice(values, func(i, j int) bool { return b.nodes[values[i]].ID < b.nodes[values[j]].ID })
		for _, v := range values {
			original := b.nodes[v]
			last := original
			if refs := v.Referrers(); refs != nil {
				for _, in := range *refs {
					if dst := b.instructions[in]; dst != nil && dst.Function == original.Function && dst.Order > last.Order {
						last = dst
					}
				}
			}
			n := b.add(&graph.Node{Kind: "trash", Label: "Утилизация · " + b.label(v), Detail: "Последнее статическое использование значения " + b.label(v), Function: original.Function, Package: original.Package, Block: last.Block, Order: last.Order + 1, Type: typeName(v), Reason: "Конец использования в SSA. Не событие освобождения памяти; для ветвей и циклов точное время неизвестно.", Source: last.Source})
			b.edge(last.ID, n.ID, "disposal", b.label(v), typeName(v))
		}
	}
}
