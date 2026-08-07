/** @type {import('next').NextConfig} */
const nextConfig = {
  // 표지 이미지는 저장하지 않고 서점 주소를 그대로 씁니다.
  // Next.js 의 이미지 최적화를 끄면 우리 서버를 거치지 않고
  // 브라우저가 서점 주소에서 바로 받아옵니다. (요구사항: 표지 저장 금지)
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default nextConfig;
