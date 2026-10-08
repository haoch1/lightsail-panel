/** Short names shared by every region selector and resource label. */
export const regionNames: Record<string, string> = {
  "ap-east-1": "Hong Kong",
  "ap-northeast-1": "Tokyo",
  "ap-northeast-2": "Seoul",
  "ap-south-1": "Mumbai",
  "ap-southeast-1": "Singapore",
  "ap-southeast-2": "Sydney",
  "ap-southeast-3": "Jakarta",
  "ap-southeast-5": "Malaysia",
  "ca-central-1": "Montreal",
  "eu-central-1": "Frankfurt",
  "eu-north-1": "Stockholm",
  "eu-south-2": "Spain",
  "eu-west-1": "Ireland",
  "eu-west-2": "London",
  "eu-west-3": "Paris",
  "sa-east-1": "Sao Paulo",
  "us-east-1": "Virginia",
  "us-east-2": "Ohio",
  "us-west-2": "Oregon",
};
export const optInRegionIds = new Set([
  "ap-east-1",
  "ap-southeast-3",
  "ap-southeast-5",
  "eu-south-2",
]);
export const regionLabel = (id: string) =>
  regionNames[id] ? `${regionNames[id]} · ${id}` : id;
export const awsRegionOptions = Object.entries(regionNames).map(
  ([id, name]) => ({
    id,
    name,
    optIn: optInRegionIds.has(id),
  }),
);
