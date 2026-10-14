// Placeholder deployment package.
//
// This is NOT application code and it is NOT the edge redirect function. It
// exists so that the IAM role, the log group, the event source mapping and the
// alarms for each function can be created and reviewed before the application
// repository is in our hands, and so that the first real deploy is a code
// update rather than a new resource.
//
// The application's own pipeline replaces the package. Every Lambda in this
// module carries ignore_changes on filename and source_code_hash for that
// reason: Terraform owns the function's identity, permissions and wiring, and
// the application pipeline owns its code.
//
// It answers 501 and logs loudly, so a placeholder reaching an environment is
// obvious in the first minute rather than the first incident.

export const handler = async (event) => {
  console.error(
    JSON.stringify({
      level: "error",
      message:
        "Infrastructure placeholder invoked. No application code is deployed to this function.",
      functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
      role: process.env.TREVEAN_FUNCTION_ROLE,
    })
  );

  return {
    statusCode: 501,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      error: {
        code: "not_implemented",
        message: "Infrastructure placeholder. Application code not deployed.",
      },
    }),
  };
};
