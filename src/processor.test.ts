import { Entity } from '@backstage/catalog-model';
import {
  GrafanaServiceModelProcessor,
  entityToServiceModel,
  ServiceModelObject,
} from './processor';

describe('catalog-backend-module-grafana-service-model', () => {
  it('should export plugin', () => {
    expect(GrafanaServiceModelProcessor).toBeDefined();
  });
});

it('should convert Component entity to service model', () => {
  const entity: Entity = {
    apiVersion: 'vSomeBackstageVersion',
    metadata: {
      name: 'test-entity',
      labels: {
        app: 'test-app',
      },
    },
    kind: 'Component',
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
  const result: ServiceModelObject = entityToServiceModel(
    entity,
    namespace,
    serviceModelVersion,
  );

  expect(result.apiVersion).toBe('servicemodel.ext.grafana.com/v1alpha1');
  expect(result.kind).toBe(entity.kind);
  expect(result.metadata?.name).toBe(entity.metadata.name);
  expect(result.metadata?.namespace).toBe(namespace);
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/test-relation']).toBe('other..test-target__foo');
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/owner']).toBe('test-owner');
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/system']).toBe('test-system');
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/subcomponentOf']).toBe('test-subcomponent');
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/type']).toBe('test-type');

  // spec.metadata is a special case, it should be copied to spec.backstageMetadata
  expect((result.spec as { backstageMetadata: any }).backstageMetadata).toEqual(entity.metadata);
});

it('should convert Group entity to service model', () => {
  const entity: Entity = {
    apiVersion: 'vSomeBackstageVersion',
    metadata: {
      name: 'test-entity',
      labels: {
        app: 'test-app',
      },
    },
    kind: 'Component',
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
  const result: ServiceModelObject = entityToServiceModel(
    entity,
    namespace,
    serviceModelVersion,
  );

  expect(result.apiVersion).toBe('servicemodel.ext.grafana.com/v1alpha1');
  expect(result.kind).toBe(entity.kind);
  expect(result.metadata?.name).toBe(entity.metadata.name);
  expect(result.metadata?.namespace).toBe(namespace);
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/test-relation']).toBe('other..test-target__foo');
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/owner']).toBe('test-owner');
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/system']).toBe('test-system');
  expect(result.metadata?.labels?.['servicemodel.ext.grafana.com/type']).toBe('test-type');

  // spec.metadata is a special case, it should be copied to spec.backstageMetadata
  expect((result.spec as { backstageMetadata: any }).backstageMetadata).toEqual(entity.metadata);
});

