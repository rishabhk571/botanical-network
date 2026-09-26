//! Native side of Botanical Network.
//!
//! Deliberately tiny: the whole app lives in the webview. Rust only does the
//! things a webview cannot - read/write files the user picks and persist the
//! app state in the per-user app-data folder.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

#[tauri::command]
fn state_file_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(state_path(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn load_state(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = state_path(&app)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(&p).map(Some).map_err(|e| e.to_string())
}

/// Atomic-ish save: write to a temp file first so a crash mid-write never
/// leaves a truncated state file behind.
#[tauri::command]
fn save_state(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let p = state_path(&app)?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    if p.exists() {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            state_file_path,
            load_state,
            save_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running Botanical Network");
}
