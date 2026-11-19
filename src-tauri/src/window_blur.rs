pub const MAX_RADIUS: u32 = 64;

#[tauri::command]
pub fn set_window_blur(window: tauri::WebviewWindow, radius: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::apply(&window, radius.min(MAX_RADIUS))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, radius);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, c_int, c_void};
    use std::sync::LazyLock;

    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};

    type DefaultConnection = unsafe extern "C" fn() -> i32;
    type SetBlurRadius = unsafe extern "C" fn(i32, i32, u32) -> i32;
    type TransactionCreate = unsafe extern "C" fn(i32) -> *mut c_void;
    type TransactionSetCornerRadius = unsafe extern "C" fn(*mut c_void, u32, f64);
    type TransactionCommit = unsafe extern "C" fn(*mut c_void, i32);

    const CORE_GRAPHICS: &[u8] =
        b"/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics\0";
    const SKY_LIGHT: &[u8] = b"/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight\0";
    const RTLD_LAZY: c_int = 0x1;
    const FALLBACK_CORNER_RADIUS: f64 = 10.0;

    extern "C" {
        fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(object: *const c_void);
    }

    #[derive(Clone, Copy)]
    struct Symbols {
        connection: DefaultConnection,
        set_radius: SetBlurRadius,
    }

    fn resolve(handle: *mut c_void, name: &[u8]) -> Result<*mut c_void, String> {
        let symbol = unsafe { dlsym(handle, name.as_ptr().cast()) };
        if symbol.is_null() {
            let printable = String::from_utf8_lossy(&name[..name.len() - 1]);
            return Err(format!("{printable} is not available on this macOS"));
        }
        Ok(symbol)
    }

    fn load() -> Result<Symbols, String> {
        let handle = unsafe { dlopen(CORE_GRAPHICS.as_ptr().cast(), RTLD_LAZY) };
        if handle.is_null() {
            return Err("CoreGraphics could not be opened".to_string());
        }
        let connection = resolve(handle, b"CGSDefaultConnectionForThread\0")?;
        let set_radius = resolve(handle, b"CGSSetWindowBackgroundBlurRadius\0")?;
        Ok(Symbols {
            connection: unsafe { std::mem::transmute::<*mut c_void, DefaultConnection>(connection) },
            set_radius: unsafe { std::mem::transmute::<*mut c_void, SetBlurRadius>(set_radius) },
        })
    }

    static SYMBOLS: LazyLock<Result<Symbols, String>> = LazyLock::new(load);

    fn symbols() -> Result<Symbols, String> {
        SYMBOLS.clone()
    }

    #[derive(Clone, Copy)]
    struct Corners {
        create: TransactionCreate,
        set_radius: TransactionSetCornerRadius,
        commit: TransactionCommit,
    }

    fn load_corners() -> Option<Corners> {
        let handle = unsafe { dlopen(SKY_LIGHT.as_ptr().cast(), RTLD_LAZY) };
        if handle.is_null() {
            return None;
        }
        let create = resolve(handle, b"SLSTransactionCreate\0").ok()?;
        let set_radius = resolve(handle, b"SLSTransactionSetWindowCornerRadius\0").ok()?;
        let commit = resolve(handle, b"SLSTransactionCommit\0").ok()?;
        Some(Corners {
            create: unsafe { std::mem::transmute::<*mut c_void, TransactionCreate>(create) },
            set_radius: unsafe {
                std::mem::transmute::<*mut c_void, TransactionSetCornerRadius>(set_radius)
            },
            commit: unsafe { std::mem::transmute::<*mut c_void, TransactionCommit>(commit) },
        })
    }

    static CORNERS: LazyLock<Option<Corners>> = LazyLock::new(load_corners);

    fn corner_radius(ns_window: &AnyObject) -> f64 {
        let known: bool = unsafe { msg_send![ns_window, respondsToSelector: sel!(_cornerRadius)] };
        if !known {
            return FALLBACK_CORNER_RADIUS;
        }
        unsafe { msg_send![ns_window, _cornerRadius] }
    }

    fn round_corners(ns_window: &AnyObject, connection: i32, number: i32) {
        let Some(corners) = *CORNERS else {
            return;
        };
        let Ok(number) = u32::try_from(number) else {
            return;
        };
        let radius = corner_radius(ns_window);
        if !radius.is_finite() || radius <= 0.0 {
            return;
        }
        let transaction = unsafe { (corners.create)(connection) };
        if transaction.is_null() {
            return;
        }
        unsafe {
            (corners.set_radius)(transaction, number, radius);
            (corners.commit)(transaction, 0);
            CFRelease(transaction);
        }
        let _: () = unsafe { msg_send![ns_window, invalidateShadow] };
    }

    pub fn apply(window: &tauri::WebviewWindow, radius: u32) -> Result<(), String> {
        let symbols = symbols()?;
        let ns_window = window.ns_window().map_err(|error| error.to_string())?;
        if ns_window.is_null() {
            return Err("the window has no native handle".to_string());
        }
        let ns_window = unsafe { &*ns_window.cast::<AnyObject>() };
        let number: isize = unsafe { msg_send![ns_window, windowNumber] };
        let number = i32::try_from(number).map_err(|_| "window number out of range".to_string())?;
        let connection = unsafe { (symbols.connection)() };
        let status = unsafe { (symbols.set_radius)(connection, number, radius) };
        if status != 0 {
            return Err(format!("the window server refused the blur radius ({status})"));
        }
        if radius > 0 {
            round_corners(ns_window, connection, number);
        }
        Ok(())
    }
}
