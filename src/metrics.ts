import { metrics as otelMetrics, ValueType } from '@opentelemetry/api';
import type {
  Counter,
  Histogram,
  Meter,
  ObservableGauge,
} from '@opentelemetry/api';

/**
 * Why an entity was not sent to the ServiceModel API.
 *
 * - `filtered`: the entity kind/type is not in `grafanaCloudCatalogInfo.allow`
 * - `unchanged`: the entity is byte-identical to the cached copy
 * - `disconnected`: Grafana was unreachable, so the entity was left for a later cycle
 */
export type SkipReason = 'filtered' | 'unchanged' | 'disconnected';

/** Which ServiceModel write was performed for an entity. */
export type SyncOperation = 'create' | 'update' | 'noop';

/** Which ServiceModel API call was made. */
export type ApiOperation = 'get' | 'create' | 'update' | 'discover';

/** How a single entity's sync attempt ended. */
export type SyncOutcome = 'success' | 'failure';

/**
 * Reports whether Grafana is currently reachable, or `undefined` when the
 * processor is disabled and the question does not apply.
 *
 * This is a function rather than a value because the connection gauge is
 * observable: it is sampled at collection time, not when a connection attempt
 * happens.
 */
export type ConnectionStateProvider = () => boolean | undefined;

const METER_NAME = '@grafana/catalog-backend-module-grafana-servicemodel';

/**
 * Prefix for every instrument this plugin creates, to distinguish these metrics
 * from other catalog modules sharing the same exporter.
 */
const PREFIX = 'grafana_servicemodel';

/**
 * Bucket boundaries for per-entity sync latency, in seconds. Skewed towards the
 * sub-second range because a healthy sync is a couple of API round trips, with
 * headroom up to the 30s request timeout.
 */
const DURATION_BUCKETS_SECONDS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

/**
 * Records what the GrafanaServiceModelProcessor is doing, so an operator can
 * answer "did the last sync succeed?" from metrics alone rather than by reading
 * logs.
 *
 * Instruments come from the global OpenTelemetry meter. When the host has not
 * registered a MeterProvider the API hands back no-op instruments, so an
 * installation that never set up OpenTelemetry is unaffected and needs no
 * configuration.
 *
 * Every call here is also wrapped so that it cannot throw. Recording a metric
 * happens inside promise executors that must reach `resolve()`, so an exception
 * escaping this class would leave an entity's processing permanently unsettled.
 * Observability must never be able to break catalog processing.
 */
export class GrafanaServiceModelMetrics {
  private readonly entitiesProcessed?: Counter;
  private readonly entitiesSynced?: Counter;
  private readonly entitiesSkipped?: Counter;
  private readonly entitiesFailed?: Counter;
  private readonly syncDuration?: Histogram;
  private readonly apiRequests?: Counter;
  private readonly connectionAttempts?: Counter;
  private readonly connectionState?: ObservableGauge;

  constructor(
    isConnected: ConnectionStateProvider,
    meter: Meter = otelMetrics.getMeter(METER_NAME),
  ) {
    // Each instrument is created independently so that one unsupported option
    // cannot cost us the rest of them.
    this.entitiesProcessed = create(() =>
      meter.createCounter(`${PREFIX}.entities.processed`, {
        description:
          'Entities the processor considered for the Grafana ServiceModel.',
        unit: '{entity}',
        valueType: ValueType.INT,
      }),
    );

    this.entitiesSynced = create(() =>
      meter.createCounter(`${PREFIX}.entities.synced`, {
        description:
          'Entities successfully written to the Grafana ServiceModel.',
        unit: '{entity}',
        valueType: ValueType.INT,
      }),
    );

    this.entitiesSkipped = create(() =>
      meter.createCounter(`${PREFIX}.entities.skipped`, {
        description:
          'Entities not written to the Grafana ServiceModel, by reason.',
        unit: '{entity}',
        valueType: ValueType.INT,
      }),
    );

    this.entitiesFailed = create(() =>
      meter.createCounter(`${PREFIX}.entities.failed`, {
        description:
          'Entities that could not be written to the Grafana ServiceModel.',
        unit: '{entity}',
        valueType: ValueType.INT,
      }),
    );

    this.syncDuration = create(() =>
      meter.createHistogram(`${PREFIX}.sync.duration`, {
        description:
          'Time to reconcile one entity against the Grafana ServiceModel.',
        unit: 's',
        valueType: ValueType.DOUBLE,
        advice: { explicitBucketBoundaries: DURATION_BUCKETS_SECONDS },
      }),
    );

    this.apiRequests = create(() =>
      meter.createCounter(`${PREFIX}.api.requests`, {
        description:
          'ServiceModel API requests, by operation and response status code.',
        unit: '{request}',
        valueType: ValueType.INT,
      }),
    );

    this.connectionAttempts = create(() =>
      meter.createCounter(`${PREFIX}.connection.attempts`, {
        description: 'Attempts to establish a connection to Grafana Cloud.',
        unit: '{attempt}',
        valueType: ValueType.INT,
      }),
    );

    // Observable, so that every collection samples the current state. A
    // synchronous gauge would only be written when a connection attempt happens,
    // and attempts stop once the connection is healthy and are backed off up to
    // an hour apart once it is not. That would leave the series stale or absent
    // for long stretches, which is exactly when an outage alert needs to fire.
    this.connectionState = create(() =>
      meter.createObservableGauge(`${PREFIX}.connection.state`, {
        description:
          'Whether Grafana Cloud is currently reachable: 1 available, 0 unavailable.',
        unit: '{state}',
        valueType: ValueType.INT,
      }),
    );

    this.connectionState?.addCallback(result => {
      try {
        const connected = isConnected();
        // Undefined means the processor is disabled, so reporting 0 would look
        // like an outage. Emit no data point at all instead.
        if (connected !== undefined) {
          result.observe(connected ? 1 : 0);
        }
      } catch {
        // Never let collection fail because of us.
      }
    });
  }

  /** An entity reached the processor and matched the configured filter. */
  recordProcessed(kind: string): void {
    swallow(() => this.entitiesProcessed?.add(1, { kind }));
  }

  /** An entity was deliberately not written. */
  recordSkipped(kind: string, reason: SkipReason): void {
    swallow(() => this.entitiesSkipped?.add(1, { kind, reason }));
  }

  /** An entity was written to the ServiceModel, or confirmed already current. */
  recordSynced(kind: string, operation: SyncOperation): void {
    swallow(() => this.entitiesSynced?.add(1, { kind, operation }));
  }

  /**
   * An entity could not be written.
   *
   * @param code - The status from the ServiceModel API when the failure produced
   *   a response, otherwise the transport error code. Reported as `unknown` when
   *   neither is available, so that no failure goes uncounted.
   */
  recordFailed(kind: string, code?: number | string): void {
    swallow(() =>
      this.entitiesFailed?.add(1, { kind, code: String(code ?? 'unknown') }),
    );
  }

  /** How long one entity took to reconcile, in seconds. */
  recordSyncDuration(
    kind: string,
    outcome: SyncOutcome,
    durationMs: number,
  ): void {
    swallow(() =>
      this.syncDuration?.record(durationMs / 1000, { kind, outcome }),
    );
  }

  /** A single ServiceModel API request completed, successfully or not. */
  recordApiRequest(operation: ApiOperation, code?: number | string): void {
    swallow(() =>
      this.apiRequests?.add(1, {
        operation,
        code: String(code ?? 'unknown'),
      }),
    );
  }

  /** A connection attempt finished. */
  recordConnectionAttempt(connected: boolean): void {
    swallow(() =>
      this.connectionAttempts?.add(1, {
        outcome: connected ? 'success' : 'failure',
      }),
    );
  }
}

/**
 * Creates an instrument, yielding undefined rather than throwing if the meter
 * rejects it. Every call site then treats the instrument as optional.
 */
function create<T>(factory: () => T): T | undefined {
  try {
    return factory();
  } catch {
    return undefined;
  }
}

/**
 * Runs a recording call, discarding any error.
 *
 * The OpenTelemetry API is no-throw by contract, so this is defence in depth
 * against a non-conforming MeterProvider. It is deliberately silent: these calls
 * sit on the path to `resolve()` for an entity, and logging a metrics failure
 * per entity would recreate the log flood this instrumentation exists to detect.
 */
function swallow(fn: () => void): void {
  try {
    fn();
  } catch {
    // Intentionally ignored.
  }
}
