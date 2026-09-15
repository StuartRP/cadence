package main

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// omarchyThemePalette carries the colors parsed from the active Omarchy
// theme's colors.toml, plus enough metadata for the frontend to decide how
// to apply it.
type omarchyThemePalette struct {
	Detected bool              `json:"detected"`
	Theme    string            `json:"theme,omitempty"`
	Mode     string            `json:"mode,omitempty"` // "dark" or "light"
	Colors   map[string]string `json:"colors,omitempty"`
}

// omarchyStateDir returns the per-session dir Omarchy uses to expose the
// active theme, or "" when Omarchy is not present on this machine.
func omarchyStateDir() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	stateDir := filepath.Join(homeDir, ".local", "state", "omarchy", "current")
	if _, err := os.Stat(stateDir); err != nil {
		return ""
	}
	return stateDir
}

// omarchyKeyRe matches the simple `key = "value"` lines colors.toml is
// written in. Omarchy's colors.toml has no nested tables or arrays, so this
// line-scanner keeps us free of a TOML dependency.
var omarchyKeyRe = regexp.MustCompile(`^\s*([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*$`)

// readOmarchyTheme resolves the current Omarchy theme name and palette.
// It returns detected=false when Omarchy is not installed/active.
func readOmarchyTheme() omarchyThemePalette {
	palette := omarchyThemePalette{Detected: false}
	stateDir := omarchyStateDir()
	if stateDir == "" {
		return palette
	}

	nameBytes, err := os.ReadFile(filepath.Join(stateDir, "theme.name"))
	if err == nil {
		name := strings.TrimSpace(string(nameBytes))
		name = strings.Title(strings.ReplaceAll(name, "-", " "))
		palette.Theme = name
	}

	colorsFile := filepath.Join(stateDir, "theme", "colors.toml")
	f, err := os.Open(colorsFile)
	if err != nil {
		return palette
	}
	defer f.Close()

	palette.Colors = make(map[string]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		m := omarchyKeyRe.FindStringSubmatch(scanner.Text())
		if len(m) != 3 {
			continue
		}
		if m[1] == "mode" {
			palette.Mode = strings.ToLower(m[2])
			continue
		}
		palette.Colors[m[1]] = m[2]
	}

	if palette.Mode == "" {
		// A theme without an explicit mode defaults to dark like Omarchy's
		// stock themes, but report detected only when we actually saw colors.
		palette.Mode = "dark"
	}
	if len(palette.Colors) > 0 {
		palette.Detected = true
	}
	return palette
}

func omarchyThemeHandler(w http.ResponseWriter, r *http.Request) {
	if !checkRequestAuthorization(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(readOmarchyTheme())
}
