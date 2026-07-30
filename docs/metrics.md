# Metrics

The processor emits metrics through the [OpenTelemetry metrics API][otel-api], so
that an operator can answer "did the last sync succeed?" from a dashboard instead
of grepping logs.

## Setup

Nothing to configure in this plugin. Instruments are taken from the global
OpenTelemetry meter, so metrics flow wherever your backend's OpenTelemetry SDK is
already pointed. Follow the Backstage guide on
[setting up OpenTelemetry][otel-setup] if you have not already.

If no `MeterProvider` is registered, the OpenTelemetry API returns no-op
instruments. An installation that never set up OpenTelemetry is therefore
unaffected and needs no configuration.

> Backstage also has an alpha `MetricsService`, which would be the more idiomatic
> choice. It is not used here because `metricsServiceRef` has no default factory
> and no released version of `@backstage/backend-defaults` implements
> `alpha.core.metrics`, so depending on it would fail backend startup. Switching
> over is a one-file change once an implementation ships.

## Instruments

| Metric                                     | Type             | Attributes          | Description                                                          |
| ------------------------------------------ | ---------------- | ------------------- | -------------------------------------------------------------------- |
| `grafana_servicemodel.entities.processed`  | Counter          | `kind`              | Entities that matched the filter and were considered for a sync.     |
| `grafana_servicemodel.entities.synced`     | Counter          | `kind`, `operation` | Entities written, or confirmed already current, in the ServiceModel. |
| `grafana_servicemodel.entities.skipped`    | Counter          | `kind`, `reason`    | Entities deliberately not written.                                   |
| `grafana_servicemodel.entities.failed`     | Counter          | `kind`, `code`      | Entities that could not be written.                                  |
| `grafana_servicemodel.sync.duration`       | Histogram        | `kind`, `outcome`   | Seconds to reconcile one entity.                                     |
| `grafana_servicemodel.api.requests`        | Counter          | `operation`, `code` | ServiceModel API requests by response status.                        |
| `grafana_servicemodel.connection.attempts` | Counter          | `outcome`           | Attempts to connect to Grafana Cloud.                                |
| `grafana_servicemodel.connection.state`    | Observable gauge | –                   | `1` when Grafana Cloud is reachable, `0` when it is not.             |

### Attribute values

- `operation` on `entities.synced` is `create`, `update`, or `noop`. A `noop`
  means the entity was already identical in Grafana, so no write was needed.
- `reason` on `entities.skipped` is:
  - `filtered` — the kind or type is not in `grafanaCloudCatalogInfo.allow`
  - `unchanged` — identical to the processor's cached copy, so no API call
  - `disconnected` — Grafana was not available when the entity arrived, so it was
    left for a later cycle
- `operation` on `api.requests` is `get`, `create`, `update`, or `discover`
  (`discover` is the API version lookup done when connecting).
- `code` is the HTTP status when the ServiceModel API returned a response, and
  otherwise the transport error code — `ECONNRESET`, `ETIMEDOUT`,
  `CERT_HAS_EXPIRED` and so on. It is `unknown` when the failure carried neither.
  So a query filtering on `code="429"` sees only throttling, while connection
  problems appear under their own codes rather than being lumped in.
  A `409` is counted as a failure because the write did not land, even though it
  is benign — the entity is not cached, so the next cycle retries it.

### How the counters relate

`entities.processed` counts only entities that got as far as a sync decision, so
`filtered` and `disconnected` skips are not included in it:

```
processed = synced + failed + skipped{reason="unchanged"}
```

An entity is counted once per catalog cycle, so all of these are rates over
cycles rather than absolute inventory counts. To see how many services Grafana
currently knows about, query the ServiceModel rather than these metrics.

The relation holds _eventually_, not at every scrape. `postProcessEntity` returns
without waiting for the ServiceModel write, so at any instant a few entities are
counted in `processed` while their write is still in flight.

Creating an entity issues **two** `get` requests — one from the existence check
and one inside the create path — so `api.requests{operation="get"}` runs at
roughly twice the create rate. Both requests are real, so the counter is accurate,
but it is worth knowing before reading the ratio as a bug.

## Example queries

Is the connection up?

```promql
grafana_servicemodel_connection_state
```

Sync throughput and error rate over the last day. A `409` means another writer
updated the object first; the entity is retried on the next cycle, so it is worth
excluding from an error-rate alert:

```promql
sum(rate(grafana_servicemodel_entities_synced_total[1d]))
sum(rate(grafana_servicemodel_entities_failed_total{code!="409"}[1d]))
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

`connection.state` is observable: it is sampled on every collection rather than
written when a connection attempt happens. That matters because attempts stop once
the connection is healthy, and are backed off up to an hour apart once it is not —
a synchronous gauge would go stale or absent exactly when an outage alert needs to
fire.

Attribute cardinality is bounded. `kind` comes from the small set of Backstage
kinds you allow, and `code` from status and transport error codes, so entity names
never become labels.

[otel-api]: https://opentelemetry.io/docs/languages/js/instrumentation/#metrics
[otel-setup]: https://backstage.io/docs/tutorials/setup-opentelemetry
