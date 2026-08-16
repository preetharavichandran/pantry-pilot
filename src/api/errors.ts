import type { FastifyReply } from "fastify";

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
};

export function sendProblem(reply: FastifyReply, problem: Problem) {
  return reply
    .status(problem.status)
    .header("content-type", "application/problem+json")
    .send(problem);
}
