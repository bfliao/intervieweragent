import { ScenarioReportView, type ScenarioReportData } from "@/components/ScenarioReportView";
import reportData from "@/data/demo/dns-report.json";

export default function DnsReportDemoPage() {
  return <ScenarioReportView data={reportData as ScenarioReportData} />;
}
