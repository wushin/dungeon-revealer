import React from "react";
import { createPaginationContainer } from "react-relay";
import styled from "@emotion/styled/macro";
import graphql from "babel-plugin-relay/macro";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { chatMessages_chat } from "./__generated__/chatMessages_chat.graphql";
import { ChatMessage } from "./chat-message";
import { ButtonBadge, IconButton } from "../chat-toggle-button";
import { ChevronDownIcon } from "../feather-icons";

const ChatMessageContainer = styled.div`
  position: relative;
  height: 100%;
`;

const FollowButtonContainer = styled.div<{ isVisible: boolean }>`
  position: absolute;
  right: 12px;
  bottom: 12px;
  opacity: ${(p) => (p.isVisible ? "1" : "0")};
`;

const ChatMessagesRenderer: React.FC<{ chat: chatMessages_chat }> = ({
  chat: { chat },
}) => {
  const [atBottom, setAtBottom] = React.useState(false);
  const showButtonTimeoutRef = React.useRef<(() => void) | null>(null);
  const [showButton, setShowButton] = React.useState(false);

  React.useEffect(
    () => () => {
      showButtonTimeoutRef.current?.();
    },
    []
  );

  React.useEffect(() => {
    showButtonTimeoutRef.current?.();
    if (!atBottom) {
      const timeout = setTimeout(() => setShowButton(true), 500);
      showButtonTimeoutRef.current = () => clearTimeout(timeout);
    } else {
      setShowButton(false);
    }
  }, [atBottom]);

  const initialEdgeLength = React.useRef(chat.edges.length);
  const [hasNewMessage, setHasNewMessages] = React.useState(false);

  React.useEffect(() => {
    if (showButton) {
      setHasNewMessages(chat.edges.length > initialEdgeLength.current);
    }
    initialEdgeLength.current = chat.edges.length;
  }, [showButton, chat.edges.length]);

  const virtuosoRef = React.useRef<VirtuosoHandle | null>(null);

  return (
    <ChatMessageContainer>
      <Virtuoso
        ref={virtuosoRef}
        initialTopMostItemIndex={chat.edges.length - 1}
        data={chat.edges}
        followOutput={true}
        atBottomStateChange={(bottom) => {
          setAtBottom(bottom);
        }}
        itemContent={(_, edge) => {
          return <ChatMessage message={edge.node} />;
        }}
      />
      <FollowButtonContainer isVisible={showButton}>
        <IconButton
          colorVariant="green"
          onClick={() =>
            virtuosoRef.current?.scrollToIndex({
              index: chat.edges.length - 1,
            })
          }
        >
          <ChevronDownIcon />
          {hasNewMessage ? <ButtonBadge /> : null}
        </IconButton>
      </FollowButtonContainer>
    </ChatMessageContainer>
  );
};

// Fetching more is not implemented yet. These all are just dummy values.
// We used a connection becaue it is easier documented how to add edges.
export const ChatMessages = createPaginationContainer(
  ChatMessagesRenderer,
  {
    chat: graphql`
      fragment chatMessages_chat on Query
      @argumentDefinitions(
        count: { type: "Int", defaultValue: 10 }
        cursor: { type: "ID" }
      ) {
        chat(first: $count, after: $cursor)
          @connection(key: "chatMessages_chat") {
          edges {
            node {
              ...chatMessage_message
            }
          }
        }
      }
    `,
  },
  {
    getVariables: () => ({ count: 0, cursor: "NOT_IMPLEMENTED_YET" }),
    query: graphql`
      query chatMessagesQuery($count: Int!, $cursor: ID) {
        ...chatMessages_chat @arguments(count: $count, cursor: $cursor)
      }
    `,
  }
);
