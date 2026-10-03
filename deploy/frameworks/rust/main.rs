// Axum 0.8: one route. Cargo deps: axum, tokio (full).
use axum::{http::{header, HeaderValue, StatusCode}, response::IntoResponse, routing::get, Router};

static DOC: &[u8] = include_bytes!("../../../www/.well-known/sustainability-data");

async fn declaration() -> impl IntoResponse {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static("application/sustainability-data+json")),
            (header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")),
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*")),
            (header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=86400")),
        ],
        DOC,
    )
}

#[tokio::main]
async fn main() {
    // `get` also answers HEAD; other methods receive 405 with Allow from axum.
    let app = Router::new().route("/.well-known/sustainability-data", get(declaration));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
