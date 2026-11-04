use serde::Serialize;

/// Facts the notification gate needs about Steam.
///
/// The frontend asks only for the part its selected notification mode uses, so the registry scan
/// and the foreground-window query are skipped when they cannot affect the outcome.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamGameState {
    pub in_game: bool,
    pub steam_foreground: bool,
    pub apps: Vec<u32>,
}

#[cfg(windows)]
pub fn steam_game_state(want_game: bool, want_foreground: bool) -> SteamGameState {
    let apps = if want_game {
        running_steam_apps()
    } else {
        Vec::new()
    };

    SteamGameState {
        in_game: !apps.is_empty(),
        steam_foreground: want_foreground && steam_main_window_foreground(),
        apps,
    }
}

#[cfg(not(windows))]
pub fn steam_game_state(_want_game: bool, _want_foreground: bool) -> SteamGameState {
    SteamGameState::default()
}

/// Steam maintains `HKCU\Software\Valve\Steam\Apps\<appid>\Running` for every app it knows how to
/// launch. A value of `1` means that app is currently running, which is the only state we need.
#[cfg(windows)]
fn running_steam_apps() -> Vec<u32> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let Ok(steam) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam\Apps")
    else {
        return Vec::new();
    };

    let mut apps: Vec<u32> = steam
        .enum_keys()
        .filter_map(Result::ok)
        .filter_map(|name| {
            let id: u32 = name.parse().ok()?;
            let key = steam.open_subkey(&name).ok()?;
            let running: u32 = key.get_value("Running").ok()?;
            (running == 1).then_some(id)
        })
        .collect();

    apps.sort_unstable();
    apps
}

/// True when the foreground window is the Steam client's main window.
///
/// The main window is owned by `steamwebhelper.exe`, uses the `SDL_app` class and is titled
/// `Steam`. Matching all three keeps the friends list, settings dialogs and the in-game overlay
/// from counting as "the Steam window".
#[cfg(windows)]
fn steam_main_window_foreground() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowTextW, IsWindowVisible,
    };

    let Some(exe) = foreground_exe_name() else {
        return false;
    };

    if !exe.eq_ignore_ascii_case("steamwebhelper.exe") && !exe.eq_ignore_ascii_case("steam.exe") {
        return false;
    }

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() || !IsWindowVisible(hwnd).as_bool() {
            return false;
        }

        let mut title = [0u16; 256];
        let title_len = GetWindowTextW(hwnd, &mut title);
        let title = String::from_utf16_lossy(&title[..title_len.max(0) as usize]);
        if !title.eq_ignore_ascii_case("Steam") {
            return false;
        }

        let mut class = [0u16; 64];
        let class_len = GetClassNameW(hwnd, &mut class);
        let class = String::from_utf16_lossy(&class[..class_len.max(0) as usize]);
        class == "SDL_app"
    }
}

/// Executable file name of the process owning the foreground window.
#[cfg(windows)]
fn foreground_exe_name() -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut length = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        );
        let _ = CloseHandle(process);
        result.ok()?;

        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        path.rsplit(['\\', '/']).next().map(str::to_string)
    }
}
