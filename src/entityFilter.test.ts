import { Entity } from '@backstage/catalog-model';
import { EntityFilter } from '@backstage/plugin-catalog-node';
import {
  entityMatch,
  allOfMultipleFilters,
  anyOfMultipleFilters,
} from './entityFilter';
import { parseEntityFilterParams } from './backstage/parseEntityFilterParams';

const service1: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'service1',
    annotations: {
      common: 'true',
      group1: 'true',
    },
  },
  spec: {
    type: 'service',
  },
};

const team1: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Group',
  metadata: {
    name: 'team1',
    annotations: {
      common: 'true',
      group1: 'true',
      group2: 'true',
    },
  },
  spec: {
    type: 'team',
  },
};

const resource1: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Resource',
  metadata: {
    name: 'resource1',
    annotations: {
      common: 'true',
      group1: 'true',
      group2: 'true',
      group3: 'true',
    },
  },
  spec: {
    type: 'resource',
  },
};

it('should parse filter params', () => {
  expect(
    entityMatch(
      service1,
      parseEntityFilterParams({
        filter: 'kind=Component,metadata.name=service1',
      }),
    ),
  ).toBe(true);
  expect(
    entityMatch(
      service1,
      parseEntityFilterParams({ filter: 'kind=Group,metadata.name=service1' }),
    ),
  ).toBe(false);
});

it('should match basic matchers', () => {
  expect(entityMatch(service1, anyOfMultipleFilters(['kind=Component']))).toBe(
    true,
  );
  expect(
    entityMatch(service1, anyOfMultipleFilters(['metadata.name=service1'])),
  ).toBe(true);
  expect(
    entityMatch(service1, anyOfMultipleFilters(['spec.type=service'])),
  ).toBe(true);
});

it('should match basic matchers in a case-insensitive way', () => {
  expect(entityMatch(service1, anyOfMultipleFilters(['kind=COMPONENT']))).toBe(
    true,
  );
  expect(
    entityMatch(service1, anyOfMultipleFilters(['metadata.name=sErvicE1'])),
  ).toBe(true);
  expect(
    entityMatch(service1, anyOfMultipleFilters(['spec.type=serVice'])),
  ).toBe(true);
});

it('should match multiple values', () => {
  expect(
    entityMatch(
      service1,
      anyOfMultipleFilters(['kind=Component', 'kind=Group']),
    ),
  ).toBe(true);
  expect(
    entityMatch(team1, anyOfMultipleFilters(['kind=Component', 'kind=Group'])),
  ).toBe(true);
  expect(entityMatch(service1, anyOfMultipleFilters(['kind=Group']))).toBe(
    false,
  );
});

it('should match on allOf filters', () => {
  const filter: EntityFilter = {
    allOf: [
      { key: 'kind', values: ['Component'] },
      { key: 'spec.type', values: ['service'] },
    ],
  };

  expect(entityMatch(service1, filter)).toBe(true);
  expect(entityMatch(team1, filter)).toBe(false);
});

it('should match on anyOf filters', () => {
  const filter: EntityFilter = {
    anyOf: [
      { key: 'metadata.annotations.group2', values: ['true'] },
      { key: 'metadata.annotations.group3', values: ['true'] },
    ],
  };

  expect(entityMatch(service1, filter)).toBe(false);
  expect(entityMatch(team1, filter)).toBe(true);
  expect(entityMatch(resource1, filter)).toBe(true);
});

it('should match on anyOf and allOf filters', () => {
  const group2filter = allOfMultipleFilters([
    'metadata.annotations.common=true',
    'metadata.annotations.group2=true',
  ]);
  const componentFilter = anyOfMultipleFilters(['kind=Component']);
  const group2ComponentFilter = allOfMultipleFilters([
    'kind=Component',
    'metadata.annotations.common=true,metadata.annotations.group2=true',
  ]);

  const notGroup2ComponentFilter: EntityFilter = {
    allOf: [componentFilter!],
    not: group2filter,
  };

  expect(entityMatch(service1, componentFilter)).toBe(true);
  expect(entityMatch(service1, anyOfMultipleFilters(['kind=Component']))).toBe(
    true,
  );

  expect(entityMatch(service1, group2filter)).toBe(false);
  expect(entityMatch(service1, group2ComponentFilter)).toBe(false);
  expect(entityMatch(service1, notGroup2ComponentFilter)).toBe(true);

  expect(entityMatch(team1, componentFilter)).toBe(false);
  expect(entityMatch(team1, group2filter)).toBe(true);
  expect(entityMatch(team1, group2ComponentFilter)).toBe(false);
  expect(entityMatch(team1, notGroup2ComponentFilter)).toBe(false);

  expect(entityMatch(resource1, componentFilter)).toBe(false);
  expect(entityMatch(resource1, group2filter)).toBe(true);
  expect(entityMatch(resource1, group2ComponentFilter)).toBe(false);
  expect(entityMatch(resource1, notGroup2ComponentFilter)).toBe(false);
});
