CREATE TABLE usage_counters (
    period TEXT NOT NULL,
    metric TEXT NOT NULL,
    value INTEGER NOT NULL,
    PRIMARY KEY (period, metric)
);
