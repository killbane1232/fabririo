// Package demo ships real Go source for a connected two-module factory.
package demo

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed source
var source embed.FS

func Materialize() (roots []string, cleanup func(), err error) {
	dir, err := os.MkdirTemp("", "fabririo-demo-*")
	if err != nil {
		return nil, nil, err
	}
	cleanup = func() { os.RemoveAll(dir) }
	err = fs.WalkDir(source, "source", func(path string, entry fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if entry.IsDir() {
			return nil
		}
		rel := strings.TrimSuffix(strings.TrimPrefix(path, "source/"), ".txt")
		target := filepath.Join(dir, filepath.FromSlash(rel))
		if e := os.MkdirAll(filepath.Dir(target), 0700); e != nil {
			return e
		}
		data, e := source.ReadFile(path)
		if e != nil {
			return e
		}
		return os.WriteFile(target, data, 0600)
	})
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	return []string{filepath.Join(dir, "dispatch"), filepath.Join(dir, "ledger")}, cleanup, nil
}
