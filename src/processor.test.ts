import { Entity } from '@backstage/catalog-model';
import {
  GrafanaServiceModelProcessor,
  entityToServiceModel,
} from './processor';
import { KubernetesObjectWithSpec } from '@kubernetes/client-node';

describe('catalog-backend-module-grafana-service-model', () => {
  it('should export plugin', () => {
    expect(GrafanaServiceModelProcessor).toBeDefined();
  });
});

it('should convert entity to service model', () => {
  const entity: Entity = {
    apiVersion: 'vSomeBackstageVersion',
    metadata: {
      name: 'test-entity',
      labels: {
        app: 'test-app',
      },
    },
    kind: 'TestKind',
    relations: [
      {
        type: 'test-relation',
        targetRef: 'other:test-target/foo',
      },
    ],
    spec: {
      owner: 'test-owner',
      system: 'test-system',
      subcomponentOf: 'test-subcomponent',
      parent: 'test-parent',
      type: 'test-type',
    },
  };

  const namespace = 'test-namespace';
  const serviceModelVersion = 'v1alpha1';
  const result: KubernetesObjectWithSpec = entityToServiceModel(
    entity,
    namespace,
    serviceModelVersion,
  );

  expect(result.apiVersion).toBe('servicemodel.ext.grafana.com/v1alpha1');
  expect(result.kind).toBe(entity.kind);
  expect(result.metadata?.name).toBe(entity.metadata.name);
  expect(result.metadata?.namespace).toBe(namespace);
  expect(result.metadata?.labels).toEqual({
    'servicemodel.ext.grafana.com/test-relation': 'other..test-target__foo',
    'servicemodel.ext.grafana.com/owner': 'test-owner',
    'servicemodel.ext.grafana.com/system': 'test-system',
    'servicemodel.ext.grafana.com/subcomponentOf': 'test-subcomponent',
    'servicemodel.ext.grafana.com/parent': 'test-parent',
    'servicemodel.ext.grafana.com/type': 'test-type',
  });

  // spec.metadata is a special case, it should be copied to spec.backstageMetadata
  expect((result.spec as { backstageMetadata: any }).backstageMetadata).toEqual(entity.metadata);
});
