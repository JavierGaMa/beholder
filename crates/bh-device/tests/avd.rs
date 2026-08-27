use bh_device::{
    enrich_avds_from_config, parse_avdmanager_list, parse_device_profiles, parse_sdkmanager_images,
};

const AVD_LIST: &str = "\
Available Android Virtual Devices:
    Name: Pixel_10_Pro_XL
  Device: pixel_10_pro_xl (Google)
    Path: /Users/x/.android/avd/Pixel_10_Pro_XL.avd
  Target: Google APIs PlayStore (Google Inc.)
          Based on: Android 17.0 (\"CinnamonBun\") Tag/ABI: google_apis_playstore/arm64-v8a
    Skin: pixel_10_pro_xl
  Sdcard: 512M
---------
    Name: Beholder_Test
  Device: pixel_7 (Google)
    Path: /Users/x/.android/avd/Beholder_Test.avd
  Target: Google APIs (based on Android 12L; API 32)
 Based on: Android 12L (Google APIs)
  Tag/ABI: google_apis/arm64-v8a
---------
";

const SDK_LIST: &str = "\
Installed packages:
  Path                                                            | Version | Description
  -------                                                         | ------- | -------
  build-tools;36.0.0                                              | 36.0.0  | Android SDK Build-Tools
  system-images;android-32;google_apis;arm64-v8a                  | 32.1.15 | Android 32 (Google APIs)
  system-images;android-36;google_apis;arm64-v8a                  | 36.1.23 | Android 36 (Google APIs)

Available Packages:
  Path                                                            | Version | Description
  -------                                                         | ------- | -------
  system-images;android-31;google_apis_playstore;arm64-v8a        | 31      | Android 31 (Google Play)
  system-images;android-37;google_apis;arm64-v8a                  | 37.1.4  | Android 37 (Google APIs)
  system-images;android-37;google_apis;x86_64                     | 37.1.4  | Android 37 (Google APIs)
  system-images;android-37;google_apis_playstore_ps16k;arm64-v8a  | 37.1.4  | Android 37 (Google Play ps16k)
  system-images;android-35;default;arm64-v8a                      | 35.1.1  | Android 35 (AOSP)
";

#[test]
fn parses_avds_with_readiness() {
    let avds = parse_avdmanager_list(AVD_LIST);
    assert_eq!(avds.len(), 2);
    assert_eq!(avds[0].name, "Pixel_10_Pro_XL");
    assert_eq!(avds[0].device.as_deref(), Some("pixel_10_pro_xl"));
    assert!(!avds[0].beholder_ready);
    assert_eq!(avds[0].image_tag.as_deref(), Some("google_apis_playstore"));
    assert_eq!(avds[1].name, "Beholder_Test");
    assert_eq!(avds[1].api_level, Some(32));
    assert!(avds[1].beholder_ready);
    assert_eq!(avds[1].image_tag.as_deref(), Some("google_apis"));
    assert_eq!(avds[1].abi.as_deref(), Some("arm64-v8a"));
}

#[test]
fn embedded_tag_abi_line_parses() {
    let avds = parse_avdmanager_list(AVD_LIST);
    assert!(avds[0]
        .image_tag
        .as_deref()
        .unwrap_or_default()
        .starts_with("google_apis_playstore"));
}

#[test]
fn enrich_overrides_from_config_ini() {
    let dir = std::env::temp_dir().join(format!("bh-avd-test-{}", std::process::id()));
    let avd_home = dir.join("MyAvd.avd");
    std::fs::create_dir_all(&avd_home).unwrap();
    std::fs::write(
        avd_home.join("config.ini"),
        "avd.ini.encoding=UTF-8\nhw.device.name=pixel_9_pro\nimage.sysdir.1=system-images/android-37.0/google_apis/arm64-v8a/\ntag.id=google_apis\n",
    )
    .unwrap();
    let stdout = format!(
        "Name: MyAvd\nDevice: old_device (Google)\nPath: {}\n Target: Whatever (Google Inc.)\n Based on: Android X Tag/ABI: google_apis_playstore/x86_64\n---------\n",
        avd_home.display()
    );
    let mut avds = parse_avdmanager_list(&stdout);
    assert_eq!(avds.len(), 1);
    assert!(!avds[0].beholder_ready);
    enrich_avds_from_config(&mut avds);
    assert_eq!(avds[0].api_level, Some(37));
    assert_eq!(avds[0].image_tag.as_deref(), Some("google_apis"));
    assert_eq!(avds[0].abi.as_deref(), Some("arm64-v8a"));
    assert!(avds[0].beholder_ready);
    assert_eq!(avds[0].device.as_deref(), Some("pixel_9_pro"));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn sdkmanager_filters_rootable_arm64_and_sorts_desc() {
    let images = parse_sdkmanager_images(SDK_LIST);
    let pkgs: Vec<&str> = images.iter().map(|i| i.pkg.as_str()).collect();
    assert_eq!(
        pkgs,
        vec![
            "system-images;android-37;google_apis;arm64-v8a",
            "system-images;android-36;google_apis;arm64-v8a",
            "system-images;android-35;default;arm64-v8a",
            "system-images;android-32;google_apis;arm64-v8a",
        ]
    );
    assert!(images.iter().find(|i| i.api == 36).unwrap().installed);
    assert!(!images.iter().find(|i| i.api == 37).unwrap().installed);
}

#[test]
fn device_profiles_filters_pixel_ids() {
    let out = "\
id: 0 || device
id: 1 || device
id: oriole_mini_2_tv_1080p || device
id: pixel_7 || device
id: pixel_7_pro || device
id: pixel_10_pro_xl || device
id: wearos_square || device
";
    let ids = parse_device_profiles(out);
    assert_eq!(ids, vec!["pixel_7", "pixel_7_pro", "pixel_10_pro_xl"]);
}
