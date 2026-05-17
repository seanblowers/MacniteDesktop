use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Package {
    pub kind: String, // "cask" | "formula"
    pub token: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogLine {
    pub stream: String, // "stdout" | "stderr" | "info" | "error"
    pub line: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StepResult {
    pub package: Package,
    pub success: bool,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstalledList {
    pub casks: Vec<String>,
    pub formulae: Vec<String>,
}

fn brew_path() -> Option<String> {
    for candidate in ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"] {
        if Path::new(candidate).exists() {
            return Some(candidate.to_string());
        }
    }
    if let Ok(out) = Command::new("/usr/bin/which").arg("brew").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    None
}

fn valid_token(token: &str) -> bool {
    !token.is_empty()
        && token.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-' | '@' | '/')
        })
}

fn emit_log(app: &AppHandle, event: &str, stream: &str, line: impl Into<String>) {
    let _ = app.emit(
        event,
        LogLine {
            stream: stream.into(),
            line: line.into(),
        },
    );
}

fn run_streaming(
    app: &AppHandle,
    event: &str,
    program: &str,
    args: &[&str],
) -> Result<std::process::ExitStatus, String> {
    emit_log(app, event, "info", format!("$ {} {}", program, args.join(" ")));
    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().ok_or("failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("failed to capture stderr")?;

    let app_o = app.clone();
    let app_e = app.clone();
    let ev_o = event.to_string();
    let ev_e = event.to_string();

    let h1 = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            emit_log(&app_o, &ev_o, "stdout", line);
        }
    });
    let h2 = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            emit_log(&app_e, &ev_e, "stderr", line);
        }
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = h1.join();
    let _ = h2.join();
    Ok(status)
}

#[tauri::command]
fn brew_installed() -> bool {
    brew_path().is_some()
}

#[tauri::command]
fn brew_location() -> Option<String> {
    brew_path()
}

#[tauri::command]
fn list_installed() -> Result<InstalledList, String> {
    let brew = brew_path().ok_or_else(|| "Homebrew is not installed.".to_string())?;
    let parse = |out: Vec<u8>| -> Vec<String> {
        String::from_utf8_lossy(&out)
            .lines()
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect()
    };
    let casks = Command::new(&brew)
        .args(["list", "--cask", "-1"])
        .output()
        .map_err(|e| e.to_string())?;
    let formulae = Command::new(&brew)
        .args(["list", "--formula", "-1"])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(InstalledList {
        casks: parse(casks.stdout),
        formulae: parse(formulae.stdout),
    })
}

#[tauri::command]
fn list_outdated() -> Result<serde_json::Value, String> {
    let brew = brew_path().ok_or_else(|| "Homebrew is not installed.".to_string())?;
    let out = Command::new(&brew)
        .args(["outdated", "--json=v2"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(if err.is_empty() {
            format!("brew outdated exited with status {:?}", out.status.code())
        } else {
            err
        });
    }
    serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
}

#[tauri::command]
async fn install_packages(
    app: AppHandle,
    packages: Vec<Package>,
    event: String,
) -> Result<Vec<StepResult>, String> {
    let brew = brew_path().ok_or_else(|| "Homebrew is not installed.".to_string())?;
    let mut results = Vec::with_capacity(packages.len());
    for pkg in packages {
        if !valid_token(&pkg.token) {
            return Err(format!("Invalid token: {}", pkg.token));
        }
        let args: Vec<&str> = if pkg.kind == "cask" {
            vec!["install", "--cask", &pkg.token]
        } else {
            vec!["install", &pkg.token]
        };
        let status = run_streaming(&app, &event, &brew, &args)?;
        results.push(StepResult {
            package: pkg,
            success: status.success(),
            exit_code: status.code(),
        });
    }
    Ok(results)
}

#[tauri::command]
async fn uninstall_packages(
    app: AppHandle,
    packages: Vec<Package>,
    event: String,
) -> Result<Vec<StepResult>, String> {
    let brew = brew_path().ok_or_else(|| "Homebrew is not installed.".to_string())?;
    let mut results = Vec::with_capacity(packages.len());
    for pkg in packages {
        if !valid_token(&pkg.token) {
            return Err(format!("Invalid token: {}", pkg.token));
        }
        let args: Vec<&str> = if pkg.kind == "cask" {
            vec!["uninstall", "--cask", &pkg.token]
        } else {
            vec!["uninstall", &pkg.token]
        };
        let status = run_streaming(&app, &event, &brew, &args)?;
        results.push(StepResult {
            package: pkg,
            success: status.success(),
            exit_code: status.code(),
        });
    }
    Ok(results)
}

#[tauri::command]
async fn upgrade_all(app: AppHandle, event: String) -> Result<bool, String> {
    let brew = brew_path().ok_or_else(|| "Homebrew is not installed.".to_string())?;
    let status = run_streaming(&app, &event, &brew, &["upgrade"])?;
    Ok(status.success())
}

#[tauri::command]
async fn upgrade_packages(
    app: AppHandle,
    packages: Vec<Package>,
    event: String,
) -> Result<Vec<StepResult>, String> {
    let brew = brew_path().ok_or_else(|| "Homebrew is not installed.".to_string())?;
    let mut results = Vec::with_capacity(packages.len());
    for pkg in packages {
        if !valid_token(&pkg.token) {
            return Err(format!("Invalid token: {}", pkg.token));
        }
        let args: Vec<&str> = if pkg.kind == "cask" {
            vec!["upgrade", "--cask", &pkg.token]
        } else {
            vec!["upgrade", &pkg.token]
        };
        let status = run_streaming(&app, &event, &brew, &args)?;
        results.push(StepResult {
            package: pkg,
            success: status.success(),
            exit_code: status.code(),
        });
    }
    Ok(results)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            brew_installed,
            brew_location,
            list_installed,
            list_outdated,
            install_packages,
            uninstall_packages,
            upgrade_packages,
            upgrade_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
