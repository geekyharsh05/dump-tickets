"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IssueCard } from "@/components/linear-issue-card";
import { BackgroundPattern } from "@/components/background-pattern";
import {
  ConnectIcon,
  DocumentIcon,
  UploadIcon,
  SparkleIcon,
  CheckIcon,
} from "@/components/icons";
import { clearURLParams, isIssueUnchanged } from "@/utils";
import { exchangeLinearToken, getLinearAuthURL } from "@/utils/linear";
import { type Issue, issuesSchema } from "@/utils/zod";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { v4 as uuid } from "uuid";
import { LINEAR } from "@/utils/constants";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Text } from "@/components/ui/text";
import { SpeechToText } from "@/components/speech-to-text";

const STEPS = ["Connect", "Prepare", "Import"] as const;

interface ProgressBarProps {
  step: number;
}

function ProgressBar({ step }: ProgressBarProps) {
  const icons = [ConnectIcon, DocumentIcon, UploadIcon];

  return (
    <div className="w-full flex items-center justify-between mb-20 max-w-lg mx-auto">
      {STEPS.map((label, idx) => {
        const Icon = icons[idx];
        const isCompleted = idx < step;
        const isCurrent = idx === step;

        return (
          <motion.div
            key={label}
            className="flex flex-col items-center flex-1 relative"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: idx * 0.2 }}
          >
            <motion.div
              className={`flex items-center justify-center w-12 h-12 rounded-xl border transition-all duration-300 ${
                isCompleted
                  ? "bg-zinc-900 border-zinc-900 text-white"
                  : isCurrent
                  ? "bg-white border-zinc-300 text-zinc-900 shadow-sm"
                  : "bg-zinc-50 border-zinc-200 text-zinc-400"
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {isCompleted ? (
                <CheckIcon className="w-5 h-5" />
              ) : (
                <Icon className="w-5 h-5" />
              )}
            </motion.div>
            <Text
              as="span"
              variant="sm"
              className={`mt-3 font-medium transition-colors ${
                isCompleted || isCurrent ? "text-zinc-900" : "text-zinc-500"
              }`}
            >
              {label}
            </Text>
            {idx < STEPS.length - 1 && (
              <div className="absolute top-6 left-[60%] w-[80%] h-px bg-zinc-200" />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

export default function Home() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue | null>(null);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [isCreatingTicketsWithAI, setIsCreatingTicketsWithAI] = useState(false);
  const [isCreatingLinearTickets, setIsCreatingLinearTickets] = useState(false);
  const [isImportComplete, setIsImportComplete] = useState(false);

  const handleTranscription = (text: string) => {
    if (textAreaRef.current) {
      const currentValue = textAreaRef.current.value;

      if (currentValue.trim()) {
        textAreaRef.current.value = currentValue + "\n\n" + text;
      } else {
        textAreaRef.current.value = text;
      }

      const event = new Event("input", { bubbles: true });
      textAreaRef.current.dispatchEvent(event);
    }
  };

  const createIssue = async (issues: Issue) => {
    if (!accessToken) {
      toast.error(
        "Missing access token. Please authenticate with Linear first."
      );
      return;
    }

    try {
      const viewerQuery = `
        query ViewerTeams {
          viewer {
            teams(first: 1) {
              nodes {
                id
                name
              }
            }
          }
        }
      `;

      const viewerRes = await fetch(LINEAR.GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ query: viewerQuery }),
      });

      const viewerData = await viewerRes.json();
      const teamId = viewerData?.data?.viewer?.teams?.nodes?.[0]?.id as
        | string
        | undefined;

      if (!teamId) {
        toast.error("Unable to resolve a Linear team for this account.");
        return;
      }

      const issueCreateMutation = `
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
            }
          }
        }
      `;

      const totalIssues = issues.issues.length;

      for (const { title, description } of issues.issues) {
        const mutationPromise = (async () => {
          const variables = {
            input: {
              teamId,
              title,
              description,
            },
          };

          const createRes = await fetch(LINEAR.GRAPHQL_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ query: issueCreateMutation, variables }),
          });

          const createData = await createRes.json();

          if (!createData?.data?.issueCreate?.success) {
            throw new Error(`Failed to create issue: ${title}`);
          }

          return createData.data.issueCreate.issue;
        })();

        toast.promise(mutationPromise, {
          loading: "Creating issue...",
          success: (issue: { identifier: string }) => {
            return `Created ${issue.identifier}: ${title}`;
          },
          error: (err: Error) => err.message,
        });

        await mutationPromise;
      }

      setIsCreatingLinearTickets(false);
      toast.success(`All ${totalIssues} issues have been imported to Linear`);
      setIsImportComplete(true);
    } catch (error) {
      console.error(error);
      toast.error("An unexpected error occurred while creating issues.");
    }
  };

  const openLinearAuth = () => {
    const verificationCode = `linear-${uuid()}`;
    localStorage.setItem("linear-verification", verificationCode);
    const authURL = getLinearAuthURL(verificationCode);
    window.location.replace(authURL);
  };

  useEffect(() => {
    (async () => {
      const authResponse = new URLSearchParams(window.location.search);
      if (!authResponse.has("code")) return;

      const verificationCode = localStorage.getItem("linear-verification");
      if (!authResponse.get("state")?.includes("linear")) return;
      if (authResponse.get("state") !== verificationCode) {
        alert("Linear auth returned an invalid code. Please try again.");
        return;
      }
      const refreshToken = authResponse.get("code");

      const { access_token } = await exchangeLinearToken(refreshToken!);
      if (!access_token) return toast.error("Failed to exchange token");

      setAccessToken(access_token);
      clearURLParams();
      setCurrentStep(1);
    })();
  }, []);

  useEffect(() => {
    if (issues?.issues?.length) {
      setCurrentStep(2);
    }
  }, [issues]);

  function removeIssue(index: number) {
    const issueTitle = issues?.issues[index]?.title || "Issue";

    setIssues((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        issues: prev.issues.filter((_, idx) => idx !== index),
      };
    });

    toast.success(`Deleted "${issueTitle}"`);
  }

  function editIssue(index: number, title: string, description: string) {
    const currentIssue = issues?.issues[index];

    // Check if anything actually changed
    if (isIssueUnchanged(currentIssue, title, description)) {
      return; // No changes, don't update or show toast
    }

    setIssues((prev) => {
      if (!prev) return prev;
      const updatedIssues = [...prev.issues];
      updatedIssues[index] = { title, description };
      return {
        ...prev,
        issues: updatedIssues,
      };
    });

    toast.success(`Updated "${title}"`);
  }

  return (
    <>
      <BackgroundPattern />
      <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-3xl mx-auto">
          <ProgressBar step={currentStep} />

          <AnimatePresence mode="wait">
            {currentStep === 0 && (
              <motion.section
                key="auth"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="text-center space-y-8"
              >
                <div className="space-y-4">
                  <Text
                    as="h1"
                    variant="5xl"
                    className="font-light tracking-tight"
                  >
                    Import issues to Linear
                  </Text>
                  <Text
                    as="p"
                    variant="lg"
                    className="text-zinc-600 font-normal max-w-md mx-auto leading-relaxed text-balance"
                  >
                    Connect your account, paste your tasks, and let AI organize
                    them into structured Linear issues.
                  </Text>
                </div>

                <Button
                  size="lg"
                  className="px-8 py-3 bg-zinc-900 hover:bg-zinc-800 text-white font-medium rounded-lg transition-colors"
                  onClick={openLinearAuth}
                  disabled={!!accessToken}
                >
                  <ConnectIcon className="w-4 h-4 mr-2" />
                  Connect Linear Account
                </Button>

                <Text
                  as="p"
                  variant="sm"
                  className="text-zinc-500 max-w-sm mx-auto text-balance"
                >
                  We'll redirect you to Linear for secure authentication. You
                  can revoke access anytime.
                </Text>
              </motion.section>
            )}

            {currentStep === 1 && (
              <motion.section
                key="prepare"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="w-full max-w-2xl mx-auto space-y-6"
              >
                <div className="text-center space-y-2">
                  <Text
                    as="h2"
                    variant="3xl"
                    className="font-light text-zinc-900"
                  >
                    Paste your tasks
                  </Text>
                  <Text
                    as="p"
                    variant="base"
                    className="text-zinc-600 max-w-lg mx-auto font-normal text-balance"
                  >
                    Add your requirements, todos, or any text. AI will structure
                    them into Linear issues.
                  </Text>
                </div>

                <div className="w-full">
                  <Textarea
                    ref={textAreaRef}
                    className="w-full min-h-[300px] text-base leading-relaxed resize-none"
                    autoFocus
                    placeholder="Paste your tasks here...

For example:
• Fix the login bug on mobile
• Add search functionality to dashboard  
• Update user profile settings
• Write API documentation"
                  />
                </div>

                <div className="w-full flex items-center space-x-2">
                  <Button
                    size="lg"
                    className="flex-1 py-3 bg-zinc-900 hover:bg-zinc-800 text-white font-medium rounded-lg transition-colors"
                    onClick={async () => {
                      const text = textAreaRef.current?.value;
                      if (!text) return toast.error("No text to process");

                      setIsCreatingTicketsWithAI(true);
                      const response = await fetch("/api/chat", {
                        method: "POST",
                        body: JSON.stringify({ text }),
                      });

                      const data = issuesSchema.safeParse(
                        await response.json()
                      );
                      if (!data.success)
                        return toast.error("Failed to parse response");

                      setIsCreatingTicketsWithAI(false);
                      setIssues(data.data);
                    }}
                    disabled={isCreatingTicketsWithAI}
                  >
                    {isCreatingTicketsWithAI ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating issues...
                      </>
                    ) : (
                      <>
                        <SparkleIcon className="w-4 h-4 mr-2" />
                        Create Issues
                      </>
                    )}
                  </Button>

                  <SpeechToText onTranscription={handleTranscription} />
                </div>
              </motion.section>
            )}

            {currentStep === 2 &&
            issues?.issues?.length &&
            !isImportComplete ? (
              <motion.section
                key="import"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between p-6 bg-white border border-zinc-200 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-2 h-2 bg-green-600 rounded-full" />
                    <Text
                      as="h2"
                      variant="lg"
                      className="font-medium text-zinc-900"
                    >
                      Ready to import
                    </Text>
                    <Text
                      as="span"
                      variant="xs"
                      className="px-2.5 py-1 bg-zinc-100 text-zinc-700 rounded-full"
                    >
                      {issues.issues.length} issues
                    </Text>
                  </div>
                  <Button
                    className="bg-zinc-900 hover:bg-zinc-800 text-white font-medium rounded-lg transition-colors"
                    onClick={async () => {
                      setIsCreatingLinearTickets(true);
                      createIssue(issues);
                    }}
                    disabled={isCreatingLinearTickets}
                  >
                    {isCreatingLinearTickets ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <UploadIcon className="w-4 h-4 mr-2" />
                        Import to Linear
                      </>
                    )}
                  </Button>
                </div>

                <motion.div
                  className="space-y-3"
                  initial="hidden"
                  animate="show"
                  variants={{
                    hidden: { opacity: 0 },
                    show: {
                      opacity: 1,
                      transition: {
                        staggerChildren: 0.1,
                      },
                    },
                  }}
                >
                  {issues.issues.map(({ title, description }, idx) => (
                    <motion.div
                      key={idx}
                      variants={{
                        hidden: { opacity: 0, y: 20 },
                        show: { opacity: 1, y: 0 },
                      }}
                    >
                      <IssueCard
                        index={idx + 1}
                        title={title}
                        description={description}
                        onDelete={() => removeIssue(idx)}
                        onEdit={(newTitle, newDescription) =>
                          editIssue(idx, newTitle, newDescription)
                        }
                      />
                    </motion.div>
                  ))}
                </motion.div>
              </motion.section>
            ) : null}

            {isImportComplete && (
              <motion.section
                key="done"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="text-center space-y-8"
              >
                <motion.div
                  className="flex items-center justify-center w-20 h-20 mx-auto rounded-full bg-green-600 text-white"
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  <CheckIcon className="w-8 h-8" />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <Text
                    as="h2"
                    variant="4xl"
                    className="font-light text-zinc-900"
                  >
                    All set!
                  </Text>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                >
                  <Text
                    as="p"
                    variant="base"
                    className="text-zinc-600 max-w-md mx-auto"
                  >
                    Your issues are now in Linear. Happy shipping! 🚀
                  </Text>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.7 }}
                >
                  <Button
                    size="lg"
                    className="px-8 py-3 bg-zinc-900 hover:bg-zinc-800 text-white font-medium rounded-lg transition-colors"
                    onClick={() => window.open("https://linear.app/", "_blank")}
                  >
                    View in Linear
                  </Button>
                </motion.div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </main>
    </>
  );
}
