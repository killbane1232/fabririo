package web

import (
	"bytes"
	"encoding/json"
	"image"
	"image/draw"
	"image/gif"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// Decode the browser encoder's output with Go's independent standard-library
// decoder, including dictionary growth, clear codes, long runs and frame delays.
func TestBrowserGIFEncoding(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js is needed for browser GIF interoperability tests")
	}
	_, file, _, _ := runtime.Caller(0)
	cmd := exec.Command(node, "--input-type=module", "-e", `
import {GIFEncoder} from './static/gif-encoder.js';
const palette=new Uint8Array(768);for(let i=0;i<256;i++)palette.set([i,i,i],i*3);
const output=[];
for(const [width,height] of [[1,1],[254,1],[255,1],[256,1],[257,1],[258,1],[1024,1],[256,128]]){
  const encoder=new GIFEncoder(width,height,palette);let seed=1234;
  for(let frame=0;frame<3;frame++){
    const pixels=new Uint8Array(width*height);
    for(let i=0;i<pixels.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[i]=frame===1?42:seed>>>24;}
    encoder.addFrame(pixels,frame===1?5:10);
  }
  output.push(Buffer.from(encoder.finish()).toString('base64'));
}

process.stdout.write(JSON.stringify(output));`)
	cmd.Dir = filepath.Dir(file)
	output, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	var streams [][]byte
	if err := json.Unmarshal(output, &streams); err != nil {
		t.Fatal(err)
	}
	for _, stream := range streams {
		animation, err := gif.DecodeAll(bytes.NewReader(stream))
		if err != nil {
			t.Fatal(err)
		}
		if len(animation.Image) != 3 || animation.LoopCount != 0 {
			t.Fatal("GIF must contain three looping frames")
		}
		seed := uint32(1234)
		for frame, img := range animation.Image {
			wantDelay := 10
			if frame == 1 {
				wantDelay = 5
			}
			if animation.Delay[frame] != wantDelay {
				t.Fatal("incorrect GIF timing")
			}
			for i, pixel := range img.Pix {
				seed = seed*1664525 + 1013904223
				want := uint8(seed >> 24)
				if frame == 1 {
					want = 42
				}
				if pixel != want {
					t.Fatalf("frame %d pixel %d: got %d, want %d", frame, i, pixel, want)
				}
			}
		}
	}
}

// Composite independently decoded delta frames, checking that moving cargo
// restores its old background and transparent holes preserve static scenery.
func TestBrowserGIFDeltaFrames(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js is needed for browser GIF interoperability tests")
	}
	_, file, _, _ := runtime.Caller(0)
	cmd := exec.Command(node, "--input-type=module", "-e", `
import {GIFEncoder} from './static/gif-encoder.js';
import {GIF_RESOLUTIONS} from './static/export-data.js';
const palette=new Uint8Array(768);for(let i=0;i<256;i++)palette.set([i,i,i],i*3);
const output=[];
for(const {width,height} of Object.values(GIF_RESOLUTIONS)){
  const encoder=new GIFEncoder(width,height,palette,{delta:true});
  const pixels=new Uint8Array(width*height).fill(42);
  pixels[width*2+3]=120;encoder.addFrame(pixels,10);
  encoder.addFrame(pixels,5);
  pixels[width*2+3]=42;pixels[width*4+7]=160;encoder.addFrame(pixels,10);
  pixels.fill(42);encoder.addFrame(pixels,10);
  output.push(Buffer.from(encoder.finish()).toString('base64'));
}
process.stdout.write(JSON.stringify(output));`)
	cmd.Dir = filepath.Dir(file)
	output, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	var streams [][]byte
	if err := json.Unmarshal(output, &streams); err != nil {
		t.Fatal(err)
	}
	sizes := []image.Point{{1280, 720}, {1920, 1080}, {2560, 1440}, {3840, 2160}}
	if len(streams) != len(sizes) {
		t.Fatal("missing resolution presets")
	}
	for i, stream := range streams {
		animation, err := gif.DecodeAll(bytes.NewReader(stream))
		if err != nil {
			t.Fatal(err)
		}
		size := sizes[i]
		if animation.Config.Width != size.X || animation.Config.Height != size.Y || len(animation.Image) != 4 || animation.LoopCount != 0 {
			t.Fatalf("incorrect dimensions or animation at %v", size)
		}
		if animation.Image[1].Bounds().Size() != image.Pt(1, 1) || animation.Image[2].Bounds() != image.Rect(3, 2, 8, 5) {
			t.Fatal("delta frames must contain only the changed rectangle")
		}
		canvas := image.NewRGBA(image.Rect(0, 0, size.X, size.Y))
		for frame, img := range animation.Image {
			if animation.Disposal[frame] != gif.DisposalNone || animation.Delay[frame] != []int{10, 5, 10, 10}[frame] {
				t.Fatal("delta frame must retain previous pixels and frame duration")
			}
			draw.Draw(canvas, img.Bounds(), img, img.Bounds().Min, draw.Over)
			for y := 0; y < size.Y; y++ {
				for x := 0; x < size.X; x++ {
					want := uint8(42)
					if frame < 2 && x == 3 && y == 2 {
						want = 120
					}
					if frame == 2 && x == 7 && y == 4 {
						want = 160
					}
					pixel := canvas.RGBAAt(x, y)
					if pixel.R != want || pixel.G != want || pixel.B != want || pixel.A != 255 {
						t.Fatalf("%v frame %d pixel (%d,%d): got %v, want %d", size, frame, x, y, pixel, want)
					}
				}
			}
		}
	}
}
