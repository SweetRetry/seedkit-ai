import { describe, it, expect } from 'vitest';
import { prepareTools } from './volcengine-prepare-tools';

describe('prepareTools', () => {
  describe('tools handling', () => {
    it('should return undefined tools when tools is undefined', () => {
      const result = prepareTools({
        tools: undefined,
        toolChoice: undefined,
      });

      expect(result).toEqual({
        tools: undefined,
        toolChoice: undefined,
        toolWarnings: [],
      });
    });

    it('should return undefined tools when tools array is empty', () => {
      const result = prepareTools({
        tools: [],
        toolChoice: undefined,
      });

      expect(result).toEqual({
        tools: undefined,
        toolChoice: undefined,
        toolWarnings: [],
      });
    });

    it('should convert function tools to Volcengine format', () => {
      const result = prepareTools({
        tools: [
          {
            type: 'function',
            name: 'get_weather',
            description: 'Get the weather for a location',
            inputSchema: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
              required: ['location'],
            },
          },
        ],
        toolChoice: undefined,
      });

      expect(result.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the weather for a location',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
              required: ['location'],
            },
          },
        },
      ]);
      expect(result.toolWarnings).toEqual([]);
    });

    it('should handle tools without description', () => {
      const result = prepareTools({
        tools: [
          {
            type: 'function',
            name: 'simple_tool',
            description: undefined,
            inputSchema: { type: 'object' },
          },
        ],
        toolChoice: undefined,
      });

      expect(result.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'simple_tool',
            description: undefined,
            parameters: { type: 'object' },
          },
        },
      ]);
    });

    it('should emit warning for provider-defined tools', () => {
      const result = prepareTools({
        tools: [
          {
            type: 'provider',
            id: 'custom-provider-tool',
          } as any,
        ],
        toolChoice: undefined,
      });

      expect(result.tools).toEqual([]);
      expect(result.toolWarnings).toEqual([
        {
          type: 'unsupported',
          feature: 'provider-defined tool custom-provider-tool',
        },
      ]);
    });

    it('should handle mixed tools (function and provider)', () => {
      const result = prepareTools({
        tools: [
          {
            type: 'function',
            name: 'valid_tool',
            description: 'A valid tool',
            inputSchema: { type: 'object' },
          },
          {
            type: 'provider',
            id: 'provider-tool',
          } as any,
          {
            type: 'function',
            name: 'another_valid_tool',
            description: 'Another valid tool',
            inputSchema: { type: 'string' },
          },
        ],
        toolChoice: undefined,
      });

      expect(result.tools).toHaveLength(2);
      expect(result.tools![0].function.name).toBe('valid_tool');
      expect(result.tools![1].function.name).toBe('another_valid_tool');
      expect(result.toolWarnings).toEqual([
        {
          type: 'unsupported',
          feature: 'provider-defined tool provider-tool',
        },
      ]);
    });

    it('should convert multiple function tools', () => {
      const result = prepareTools({
        tools: [
          {
            type: 'function',
            name: 'tool_1',
            description: 'First tool',
            inputSchema: { type: 'object' },
          },
          {
            type: 'function',
            name: 'tool_2',
            description: 'Second tool',
            inputSchema: { type: 'array' },
          },
        ],
        toolChoice: undefined,
      });

      expect(result.tools).toHaveLength(2);
      expect(result.toolChoice).toBeUndefined();
      expect(result.toolWarnings).toEqual([]);
    });
  });

  describe('toolChoice handling', () => {
    const sampleTools = [
      {
        type: 'function' as const,
        name: 'sample_tool',
        description: 'A sample tool',
        inputSchema: { type: 'object' },
      },
    ];

    it('should return undefined toolChoice when not specified', () => {
      const result = prepareTools({
        tools: sampleTools,
        toolChoice: undefined,
      });

      expect(result.toolChoice).toBeUndefined();
    });

    it('should pass through "auto" toolChoice', () => {
      const result = prepareTools({
        tools: sampleTools,
        toolChoice: { type: 'auto' },
      });

      expect(result.toolChoice).toBe('auto');
    });

    it('should pass through "none" toolChoice', () => {
      const result = prepareTools({
        tools: sampleTools,
        toolChoice: { type: 'none' },
      });

      expect(result.toolChoice).toBe('none');
    });

    it('should convert "required" toolChoice', () => {
      const result = prepareTools({
        tools: sampleTools,
        toolChoice: { type: 'required' },
      });

      expect(result.toolChoice).toBe('required');
    });

    it('should convert specific tool choice to function format', () => {
      const result = prepareTools({
        tools: sampleTools,
        toolChoice: { type: 'tool', toolName: 'sample_tool' },
      });

      expect(result.toolChoice).toEqual({
        type: 'function',
        function: { name: 'sample_tool' },
      });
    });

    it('should handle tool choice for non-existent tool name', () => {
      const result = prepareTools({
        tools: sampleTools,
        toolChoice: { type: 'tool', toolName: 'non_existent_tool' },
      });

      expect(result.toolChoice).toEqual({
        type: 'function',
        function: { name: 'non_existent_tool' },
      });
    });
  });

  describe('edge cases', () => {
    it('should handle complex input schema', () => {
      const complexSchema = {
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            properties: {
              deep: { type: 'string' },
            },
          },
          array: {
            type: 'array',
            items: { type: 'number' },
          },
        },
        required: ['nested'],
      };

      const result = prepareTools({
        tools: [
          {
            type: 'function',
            name: 'complex_tool',
            description: 'Tool with complex schema',
            inputSchema: complexSchema,
          },
        ],
        toolChoice: undefined,
      });

      expect(result.tools![0].function.parameters).toEqual(complexSchema);
    });

    it('should preserve all tool properties in output', () => {
      const result = prepareTools({
        tools: [
          {
            type: 'function',
            name: 'full_tool',
            description: 'Complete tool definition',
            inputSchema: {
              type: 'object',
              properties: {
                param1: { type: 'string', description: 'First param' },
                param2: { type: 'number', minimum: 0 },
              },
              required: ['param1'],
            },
          },
        ],
        toolChoice: { type: 'auto' },
      });

      expect(result).toMatchObject({
        tools: [
          {
            type: 'function',
            function: {
              name: 'full_tool',
              description: 'Complete tool definition',
              parameters: {
                type: 'object',
                properties: {
                  param1: { type: 'string', description: 'First param' },
                  param2: { type: 'number', minimum: 0 },
                },
                required: ['param1'],
              },
            },
          },
        ],
        toolChoice: 'auto',
        toolWarnings: [],
      });
    });
  });
});
