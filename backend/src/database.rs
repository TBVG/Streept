use anyhow::Context;
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;

pub struct Database {
    pool: PgPool,
}

impl Database {
    pub async fn new(database_url: &str) -> anyhow::Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect(database_url)
            .await
            .context("Failed to connect to database")?;

        Ok(Database { pool })
    }

    /// Wraps an already-connected pool. See AppState::from_pool_for_test
    /// for the primary use case (tests).
    pub fn from_pool(pool: PgPool) -> Self {
        Database { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn run_migrations(&self) -> anyhow::Result<()> {
        info!("Running database migrations...");
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await
            .context("Failed to run migrations")?;
        info!("Migrations completed");
        Ok(())
    }
}

