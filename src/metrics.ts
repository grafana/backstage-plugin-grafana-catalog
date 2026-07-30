import type {
  MetricsService,
  MetricsServiceCounter,
  MetricsServiceGauge,
  MetricsServiceHistogram,
} from '@backstage/backend-plugin-api/alpha';

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
 * Prefix for every instrument this plugin creates.
 *
 * The MetricsService already scopes instruments per plugin, so this only needs
 * to distinguish these metrics from other catalog modules.
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
 * Every method is a no-op when no MetricsService is supplied. That keeps the
 * processor's own code free of conditionals, keeps `fromConfig` usable without
 * a MetricsService, and means an installation that has not wired up the alpha
 * MetricsService still runs normally, just without metrics.
 */
export class GrafanaServiceModelMetrics {
  private readonly entitiesProcessed?: MetricsServiceCounter;
  private readonly entitiesSynced?: MetricsServiceCounter;
  private readonly entitiesSkipped?: MetricsServiceCounter;
  private readonly entitiesFailed?: MetricsServiceCounter;
  private readonly syncDuration?: MetricsServiceHistogram;
  private readonly apiRequests?: MetricsServiceCounter;
  private readonly connectionAttempts?: MetricsServiceCounter;
  private readonly connectionState?: MetricsServiceGauge;

  constructor(metrics?: MetricsService) {
    if (!metrics) {
      return;
    }

    this.entitiesProcessed = metrics.createCounter(
      `${PREFIX}.entities.processed`,
      {
        description:
          'Entities the processor considered for the Grafana ServiceModel.',
        unit: '{entity}',
      },
    );

    this.entitiesSynced = metrics.createCounter(`${PREFIX}.entities.synced`, {
      description: 'Entities successfully written to the Grafana ServiceModel.',
      unit: '{entity}',
    });

    this.entitiesSkipped = metrics.createCounter(`${PREFIX}.entities.skipped`, {
      description:
        'Entities not written to the Grafana ServiceModel, by reason.',
      unit: '{entity}',
    });

    this.entitiesFailed = metrics.createCounter(`${PREFIX}.entities.failed`, {
      description:
        'Entities that could not be written to the Grafana ServiceModel.',
      unit: '{entity}',
    });

    this.syncDuration = metrics.createHistogram(`${PREFIX}.sync.duration`, {
      description:
        'Time to reconcile one entity against the Grafana ServiceModel.',
      unit: 's',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS_SECONDS },
    });

    this.apiRequests = metrics.createCounter(`${PREFIX}.api.requests`, {
      description:
        'ServiceModel API requests, by operation and response status code.',
      unit: '{request}',
    });

    this.connectionAttempts = metrics.createCounter(
      `${PREFIX}.connection.attempts`,
      {
        description: 'Attempts to establish a connection to Grafana Cloud.',
        unit: '{attempt}',
      },
    );

    this.connectionState = metrics.createGauge(`${PREFIX}.connection.state`, {
      description:
        'Whether Grafana Cloud is currently reachable: 1 available, 0 unavailable.',
      unit: '{state}',
    });
  }

  /** An entity reached the processor and matched the configured filter. */
  recordProcessed(kind: string): void {
    this.entitiesProcessed?.add(1, { kind });
  }

  /** An entity was deliberately not written. */
  recordSkipped(kind: string, reason: SkipReason): void {
    this.entitiesSkipped?.add(1, { kind, reason });
  }

  /** An entity was written to the ServiceModel, or confirmed already current. */
  recordSynced(kind: string, operation: SyncOperation): void {
    this.entitiesSynced?.add(1, { kind, operation });
  }

  /**
   * An entity could not be written.
   *
   * @param code - The HTTP status from the ServiceModel API, if the failure came
   *   from a response. Reported as `unknown` otherwise, so that transport-level
   *   failures are still counted.
   */
  recordFailed(kind: string, code?: number | string): void {
    this.entitiesFailed?.add(1, { kind, code: String(code ?? 'unknown') });
  }

  /** How long one entity took to reconcile, in seconds. */
  recordSyncDuration(
    kind: string,
    outcome: SyncOutcome,
    durationMs: number,
  ): void {
    this.syncDuration?.record(durationMs / 1000, { kind, outcome });
  }

  /** A single ServiceModel API request completed, successfully or not. */
  recordApiRequest(operation: ApiOperation, code?: number | string): void {
    this.apiRequests?.add(1, {
      operation,
      code: String(code ?? 'unknown'),
    });
  }

  /**
   * A connection attempt finished. Also republishes the connection gauge, so the
   * gauge and the attempt counter can never disagree.
   */
  recordConnectionAttempt(connected: boolean): void {
    this.connectionAttempts?.add(1, {
      outcome: connected ? 'success' : 'failure',
    });
    this.recordConnectionState(connected);
  }

  /** Publishes whether Grafana is currently reachable. */
  recordConnectionState(connected: boolean): void {
    this.connectionState?.record(connected ? 1 : 0);
  }
}
