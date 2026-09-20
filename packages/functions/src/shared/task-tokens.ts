import { SFNClient, SendTaskFailureCommand, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';

/**
 * Task-token resumption for the two `.waitForTaskToken` pauses (§11.3, §11.7).
 * Textract completion and human correction both arrive outside the execution,
 * so both resolve through here: look the token up where the waiter stored it
 * (DynamoDB for Textract JobIds, the case record for corrections) and drive
 * the parked state to success or to a taxonomy-coded failure. A lost message
 * is a timed-out state — never a hung execution — because the state carries
 * its own `TimeoutSeconds` alongside the 6 h token TTL.
 */
const client = new SFNClient({});

export async function resumeWithOutput(taskToken: string, output: string): Promise<void> {
  await client.send(new SendTaskSuccessCommand({ taskToken, output }));
}

export async function failWithCode(taskToken: string, code: string, cause: string): Promise<void> {
  await client.send(new SendTaskFailureCommand({ taskToken, error: code, cause }));
}
