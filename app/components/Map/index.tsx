"use client";

import dynamic from "next/dynamic";

const AppleMap = dynamic(() => import("./AppleMap"), {
  ssr: false,
});

export default AppleMap;