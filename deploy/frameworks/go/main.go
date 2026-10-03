// Go net/http: one handler for /.well-known/sustainability-data. Run: PORT=3000 go run .
//
// http.ServeContent supplies Content-Length (also on HEAD), Last-Modified from the file's date,
// and the conditional-request logic (If-None-Match with weak comparison, If-Modified-Since, 304).
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func main() {
	// The document: data/sustainability-data.json beside the program, or the file SD_FILE names.
	file := os.Getenv("SD_FILE")
	if file == "" {
		file = filepath.Join("data", "sustainability-data.json")
	}
	doc, err := os.ReadFile(file)
	if err != nil {
		log.Fatalf("cannot read the declaration at %s (%v); put it there or set SD_FILE", file, err)
	}
	info, err := os.Stat(file)
	if err != nil {
		log.Fatalf("cannot stat %s: %v", file, err)
	}
	sum := sha256.Sum256(doc)
	etag := `"` + hex.EncodeToString(sum[:])[:32] + `"`

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/sustainability-data", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.WriteHeader(http.StatusMethodNotAllowed)
			_, _ = w.Write([]byte(`{"error":"method not allowed"}`))
			return
		}
		h := w.Header()
		h.Set("Content-Type", "application/sustainability-data+json")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Cache-Control", "public, max-age=86400")
		h.Set("ETag", etag)
		http.ServeContent(w, r, "", info.ModTime(), bytes.NewReader(doc))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	srv := &http.Server{
		Addr:              "127.0.0.1:" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}
