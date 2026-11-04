import { BenchmarkResults } from "@/components/lab/benchmark-results"

export const metadata = { title: "Benchmark results · Sentra" }

export default async function BenchmarkResultsPage({
  params,
}: PageProps<"/lab/benchmarks/[code]/results">) {
  const { code } = await params
  return <BenchmarkResults code={code.toUpperCase()} />
}
