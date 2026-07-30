# Metrics

The processor emits metrics through Backstage's [`MetricsService`][metrics-service],
which is a facade over the OpenTelemetry meter API. The goal is that an operator
can answer "did the last sync succeed?" from a dashboard, instead of grepping
logs.

## Setup

Nothing to configure in this plugin. Metrics flow wherever your backend's
OpenTelemetry SDK is already pointed, so follow the Backstage guide on
[configuring an OpenTelemetry exporter][otel-setup] if you have not already.

If your installation does not provide a `MetricsService`, the processor runs
exactly as before and simply emits nothing.

## Instruments

| Metric                                     | Type      | Attributes          | Description                                                          |
| ------------------------------------------ | --------- | ------------------- | -------------------------------------------------------------------- |
| `grafana_servicemodel.entities.processed`  | Counter   | `kind`              | Entities that matched the filter and were considered for a sync.     |
| `grafana_servicemodel.entities.synced`     | Counter   | `kind`, `operation` | Entities written, or confirmed already current, in the ServiceModel. |
| `grafana_servicemodel.entities.skipped`    | Counter   | `kind`, `reason`    | Entities deliberately not written.                                   |
| `grafana_servicemodel.entities.failed`     | Counter   | `kind`, `code`      | Entities that could not be written.                                  |
| `grafana_servicemodel.sync.duration`       | Histogram | `kind`, `outcome`   | Seconds to reconcile one entity.                                     |
| `grafana_servicemodel.api.requests`        | Counter   | `operation`, `code` | ServiceModel API requests by response status.                        |
| `grafana_servicemodel.connection.attempts` | Counter   | `outcome`           | Attempts to connect to Grafana Cloud.                                |
| `grafana_servicemodel.connection.state`    | Gauge     | –                   | `1` when Grafana Cloud is reachable, `0` when it is not.             |

### Attribute values

- `operation` on `entities.synced` is `create`, `update`, or `noop`. A `noop`
  means the entity was already identical in Grafana, so no write was needed.
- `reason` on `entities.skipped` is:
  - `filtered` — the kind or type is not in `grafanaCloudCatalogInfo.allow`
  - `unchanged` — identical to the processor's cached copy, so no API call
  - `disconnected` — Grafana was unreachable, so the entity was left for a later cycle
- `operation` on `api.requests` is `get`, `create`, `update`, or `discover`
  (`discover` is the API version lookup done when connecting).
- `code` is the HTTP status from the ServiceModel API, or `unknown` for a
  failure that never produced a response, such as a connection reset.

### How the counters relate

`entities.processed` counts only entities that got as far as a sync decision, so
`filtered` and `disconnected` skips are not included in it:

```
processed = synced + failed + skipped{reason="unchanged"}
```

An entity is counted once per catalog cycle, so all of these are rates over
cycles rather than absolute inventory counts. To see how many services Grafana
currently knows about, query the ServiceModel rather than these metrics.

## Example queries

Is the connection up?

```promql
grafana_servicemodel_connection_state
```

Sync throughput and error rate over the last day:

```promql
sum(rate(grafana_servicemodel_entities_synced_total[1d]))
sum(rate(grafana_servicemodel_entities_failed_total[1d]))
```

Alert when the connection has been down for 15 minutes:

```promql
max_over_time(grafana_servicemodel_connection_state[15m]) == 0
```

Alert when nothing has synced in two hours, which catches a silent stall such as
an expired token:

```promql
sum(increase(grafana_servicemodel_entities_synced_total[2h])) == 0
```

Are we being throttled?

```promql
sum by (operation) (rate(grafana_servicemodel_api_requests_total{code="429"}[5m]))
```

95th percentile sync latency:

```promql
histogram_quantile(
  0.95,
  sum by (le) (rate(grafana_servicemodel_sync_duration_bucket[5m]))
)
```

## Notes

Metric names are shown here as declared. Exporters rewrite them to suit their
own conventions, so a Prometheus scrape will show `_total` suffixes on counters
and `.` replaced by `_`, as in the queries above.

Attribute cardinality is bounded. `kind` comes from the small set of Backstage
kinds you allow, and `code` from HTTP statuses, so entity names never become
labels.

[metrics-service]: https://backstage.io/docs/backend-system/core-services/metrics
[otel-setup]: https://backstage.io/docs/tutorials/setup-opentelemetry
