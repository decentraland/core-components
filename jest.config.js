module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/components', '<rootDir>/shared'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'components/*/src/**/*.ts',
    'shared/*/src/**/*.ts',
    '!**/*.d.ts',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
}
