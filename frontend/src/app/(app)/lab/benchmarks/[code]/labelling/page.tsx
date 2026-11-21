import { BenchmarkLabelling } from "@/components/lab/benchmark-labelling"

export const metadata = { title: "Benchmark labelling · Sentra" }

export default async function BenchmarkLabellingPage({
  params,
}: PageProps<"/lab/benchmarks/[code]/labelling">) {
  const { code } = await params
  return <BenchmarkLabelling code={code.toUpperCase()} />
}
