import { IConfigComponent } from '@well-known-components/interfaces'

export function createConfigMockedComponent(overrides?: Partial<IConfigComponent>): IConfigComponent {
  return {
    requireString: overrides?.requireString ?? jest.fn(),
    requireNumber: overrides?.requireNumber ?? jest.fn(),
    getNumber: overrides?.getNumber ?? jest.fn(),
    getString: overrides?.getString ?? jest.fn()
  }
}
