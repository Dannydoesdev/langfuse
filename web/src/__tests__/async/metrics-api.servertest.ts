import { randomUUID } from "crypto";
import {
  makeZodVerifiedAPICall,
  makeZodVerifiedAPICallSilent,
  makeAPICall,
} from "@/src/__tests__/test-utils";
import { GetMetricsV1Response } from "@/src/features/public-api/types/metrics";
import { createBasicAuthHeader } from "@langfuse/shared/src/server";
import { type QueryType } from "@/src/features/query/types";
import {
  createTrace,
  createObservation,
  createTracesCh,
  createObservationsCh,
} from "@langfuse/shared/src/server";

describe("/api/public/metrics API Endpoint", () => {
  // Test setup variables
  const testTraces: Array<{
    id: string;
    name: string;
    timestamp: Date;
    metadata?: Record<string, any>;
  }> = [];
  const testMetadataValue = randomUUID();
  const projectId = "7a88fb47-b4e2-43b8-a06c-a5ce950dc53a";

  // Current time for traces
  const tomorrow = new Date(new Date().getTime() + 3600 * 24 * 1000);
  const now = new Date();
  const yesterday = new Date(new Date().getTime() - 3600 * 24 * 1000);
  const twoDaysAgo = new Date(new Date().getTime() - 3600 * 24 * 2 * 1000);

  // Set up test data before running tests
  beforeAll(async () => {
    // Create test traces with different names
    const trace1Id = randomUUID();
    const trace2Id = randomUUID();
    const trace3Id = randomUUID();

    // Create traces with different names and timestamps
    testTraces.push(
      {
        id: trace1Id,
        name: "trace-test-1",
        timestamp: now,
        metadata: { test: testMetadataValue },
      },
      {
        id: trace2Id,
        name: "trace-test-2",
        timestamp: yesterday,
        metadata: { test: testMetadataValue },
      },
      {
        id: trace3Id,
        name: "trace-test-3",
        timestamp: yesterday,
        metadata: { test: testMetadataValue },
      },
    );

    // Insert traces into database
    await createTracesCh(
      testTraces.map((trace) =>
        createTrace({
          id: trace.id,
          name: trace.name,
          project_id: projectId,
          timestamp: trace.timestamp.getTime(),
          metadata: trace.metadata || {},
        }),
      ),
    );

    // Create observations for trace1
    const trace1Observations = [];
    for (let i = 0; i < 3; i++) {
      trace1Observations.push(
        createObservation({
          id: randomUUID(),
          trace_id: trace1Id,
          project_id: projectId,
          name: `observation-${i}`,
          start_time: now.getTime(),
          metadata: { test: testMetadataValue },
        }),
      );
    }

    // Create observations for trace2
    const trace2Observations = [];
    for (let i = 0; i < 2; i++) {
      trace2Observations.push(
        createObservation({
          id: randomUUID(),
          trace_id: trace2Id,
          project_id: projectId,
          name: `observation-${i}`,
          start_time: yesterday.getTime(),
          metadata: { test: testMetadataValue },
        }),
      );
    }
    await createObservationsCh([...trace1Observations, ...trace2Observations]);
  });

  it.each([
    [
      "simple trace query",
      {
        view: "traces",
        dimensions: [{ field: "name" }],
        metrics: [{ measure: "count", aggregation: "count" }],
        filters: [
          {
            column: "metadata",
            operator: "contains",
            key: "test",
            value: testMetadataValue,
            type: "stringObject",
          },
        ],
        timeDimension: null,
        fromTimestamp: twoDaysAgo.toISOString(),
        toTimestamp: tomorrow.toISOString(),
        orderBy: null,
      } as QueryType,
      // Expected result structure (data will be dummy)
      {
        dataLength: 3,
        expectedMetrics: ["count_count"],
        expectedDimensions: ["name"],
      },
    ],
    [
      "query with time dimension",
      {
        view: "traces",
        dimensions: [{ field: "name" }],
        metrics: [{ measure: "count", aggregation: "count" }],
        filters: [
          {
            column: "metadata",
            operator: "contains",
            key: "test",
            value: testMetadataValue,
            type: "stringObject",
          },
        ],
        timeDimension: {
          granularity: "day",
        },
        fromTimestamp: twoDaysAgo.toISOString(),
        toTimestamp: tomorrow.toISOString(),
        orderBy: null,
      } as QueryType,
      // Expected result structure
      {
        dataLength: 4,
        expectedMetrics: ["count_count"],
        expectedDimensions: ["time_dimension", "name"],
      },
    ],
    [
      "observations query with multiple metrics",
      {
        view: "observations",
        dimensions: [{ field: "name" }],
        metrics: [
          { measure: "count", aggregation: "count" },
          { measure: "latency", aggregation: "p95" },
        ],
        filters: [
          {
            column: "metadata",
            operator: "contains",
            key: "test",
            value: testMetadataValue,
            type: "stringObject",
          },
        ],
        timeDimension: null,
        fromTimestamp: twoDaysAgo.toISOString(),
        toTimestamp: tomorrow.toISOString(),
        orderBy: null,
      } as QueryType,
      // Expected result structure
      {
        dataLength: 3,
        expectedMetrics: ["count_count", "p95_latency"],
        expectedDimensions: ["name"],
      },
    ],
  ])(
    "should accept queries and return expected results: %s",
    async (
      _name: string,
      queryObject: QueryType,
      expectedResult: {
        dataLength: number;
        expectedMetrics: string[];
        expectedDimensions: string[];
      },
    ) => {
      // Add pagination parameters needed for the API
      const fullQuery = {
        ...queryObject,
        // page: 1,
        // limit: 10,
      };

      // Make the API call
      const response = await makeZodVerifiedAPICall(
        GetMetricsV1Response,
        "GET",
        `/api/public/metrics?query=${encodeURIComponent(JSON.stringify(fullQuery))}`,
      );

      // Validate response format
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data)).toBe(true);

      // Validate response matches expected structure
      expect(response.body.data).toHaveLength(expectedResult.dataLength);
      response.body.data.forEach((item) => {
        expect(
          expectedResult.expectedMetrics.every((metric) => metric in item),
        ).toBe(true);
        expect(
          expectedResult.expectedDimensions.every(
            (dimension) => dimension in item,
          ),
        ).toBe(true);
      });
    },
  );

  it("should return 401 with invalid authentication", async () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    // Create the query object
    const query = {
      view: "traces",
      metrics: [
        {
          measure: "totalCount",
          aggregation: "count",
        },
      ],
      fromTimestamp: yesterday.toISOString(),
      toTimestamp: now.toISOString(),
      page: 1,
      limit: 10,
    };

    const invalidAuth = createBasicAuthHeader(
      "invalid-project-key",
      "invalid-secret-key",
    );

    const { status } = await makeAPICall(
      "GET",
      `/api/public/metrics?query=${encodeURIComponent(JSON.stringify(query))}`,
      undefined,
      invalidAuth,
    );

    expect(status).toBe(401);
  });

  it("should return 400 for invalid query parameters", async () => {
    // Test missing required parameters by sending an invalid JSON string
    const { status } = await makeZodVerifiedAPICallSilent(
      GetMetricsV1Response,
      "GET",
      `/api/public/metrics?query=invalid-json-string`,
      undefined,
    );

    expect(status).toBe(400);
  });

  it("should return 400 for incomplete query object", async () => {
    // Missing required fields in the query object
    const incompleteQuery = {
      view: "traces",
      // Missing metrics, fromTimestamp, toTimestamp
    };

    const { status } = await makeZodVerifiedAPICallSilent(
      GetMetricsV1Response,
      "GET",
      `/api/public/metrics?query=${encodeURIComponent(JSON.stringify(incompleteQuery))}`,
      undefined,
    );

    expect(status).toBe(400);
  });
});
