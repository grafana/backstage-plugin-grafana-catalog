import { Entity } from '@backstage/catalog-model';
import { EntityFilter } from '@backstage/plugin-catalog-node';
import { parseEntityFilterParams } from './backstage/parseEntityFilterParams';

export function entityMatch(
  entity: Entity,
  filter: EntityFilter | undefined,
): boolean {
  if (!filter) {
    return false;
  }

  if ('key' in filter) {
    const values = filter.values || [];
    const entityValue = getNestedValue(entity, filter.key);
    return values.some(
      value =>
        String(value).toLowerCase() === String(entityValue).toLowerCase(),
    );
  }

  if ('anyOf' in filter) {
    return filter.anyOf.some(subFilter => entityMatch(entity, subFilter));
  }

  if ('allOf' in filter) {
    return filter.allOf.every(subFilter => entityMatch(entity, subFilter));
  }

  if ('not' in filter) {
    return !entityMatch(entity, filter.not);
  }

  return false;
}

export function allOfMultipleFilters(
  params: string[],
): EntityFilter | undefined {
  // return an EntityFilter by with the anyOf as the result of mapping over params
  return {
    allOf: params
      .map(param => parseEntityFilterParams({ filter: param }))
      .filter((filter): filter is EntityFilter => filter !== undefined),
  };
}

export function anyOfMultipleFilters(
  params: string[],
): EntityFilter | undefined {
  // return an EntityFilter by with the anyOf as the result of mapping over params
  return {
    anyOf: params
      .map(param => parseEntityFilterParams({ filter: param }))
      .filter((filter): filter is EntityFilter => filter !== undefined),
  };
}

type NestedValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? Rest extends string
      ? NestedValue<T[K], Rest>
      : never
    : never
  : P extends keyof T
  ? T[P]
  : never;

function getNestedValue<T, P extends string>(
  obj: T,
  path: P,
): NestedValue<T, P> {
  const keys = path.split('.') as string[];
  let result: any = obj;
  for (const key of keys) {
    result = result[key];
  }
  return result;
}
