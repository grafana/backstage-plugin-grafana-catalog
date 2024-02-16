import { ConfigReader } from '@backstage/config';

const CONFIG = {
  grafanaCloudCatalogInfo: {
    stack_slug: 'dev',
    grafana_endpoint: 'https://grafana-dev.com',
    token: 'token',
    allow: ['kind=Component,spec.type=service', 'kind=Group,spec.type=team'],
  },
};

it('should read values', () => {
  const config = new ConfigReader(CONFIG);

  expect(config.getString('grafanaCloudCatalogInfo.stack_slug')).toBe('dev');
  expect(config.getString('grafanaCloudCatalogInfo.token')).toBe('token');
  expect(config.getString('grafanaCloudCatalogInfo.grafana_endpoint')).toBe(
    'https://grafana-dev.com',
  );
});

it('should read nested allow values', () => {
  const config = new ConfigReader(CONFIG);
  const allowConfig = config.getStringArray('grafanaCloudCatalogInfo.allow');

  expect(allowConfig[0]).toEqual('kind=Component,spec.type=service');
  expect(allowConfig[1]).toEqual('kind=Group,spec.type=team');
});
