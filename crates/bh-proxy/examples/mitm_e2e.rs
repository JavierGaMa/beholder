fn main() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let dir = "std::env::temp_dir().join("beholder-e2e-ca")");
        let _ = std::fs::remove_dir_all(&dir);
        let ca = bh_ca::load_or_create(&dir).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        let sink = std::sync::Arc::new(bh_core::RecordingSink::default());
        let handle = bh_proxy::start_mitm(0, &ca, 2_000_000, sink).await.unwrap();
        println!("PORT={}", handle.port);
        std::future::pending::<()>().await;
    });
}
