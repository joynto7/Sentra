import { BenchmarkProgress } from "@/components/lab/benchmark-progress"

export const metadata = { title: "Benchmark run · Sentra" }

export default async function BenchmarkPage({ params }: PageProps<"/lab/benchmarks/[code]">) {
  const { code } = await params
  return <BenchmarkProgress code={code.toUpperCase()} />
}
