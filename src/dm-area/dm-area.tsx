import "./offscreen-canvas-polyfill";
import * as React from "react";
import produce from "immer";
import debounce from "lodash/debounce";
import useAsyncEffect from "@n1ru4l/use-async-effect";
import { SelectMapModal } from "./select-map-modal";
import { ImportFileModal } from "./import-file-modal";
import { MediaLibrary } from "./media-library";
import { useSocket } from "../socket";
import { buildApiUrl } from "../public-url";
import { useStaticRef } from "../hooks/use-static-ref";
import { AuthenticationScreen } from "../authentication-screen";
import { SplashScreen } from "../splash-screen";
import { FetchContext } from "./fetch-context";
import { ToastProvider } from "react-toast-notifications";
import { ISendRequestTask, sendRequest } from "../http-request";
import { AuthenticatedAppShell } from "../authenticated-app-shell";
import { AccessTokenProvider } from "../hooks/use-access-token";
import { usePersistedState } from "../hooks/use-persisted-state";
import { DmMap } from "./dm-map";
import { Socket } from "socket.io-client";
import { MapEntity, MapTokenEntity, MarkedAreaEntity } from "../map-typings";
import { useDropZone } from "../hooks/use-drop-zone";
import { useNoteWindowActions } from "./token-info-aside";
import { MapControlInterface } from "../map-view";

const useLoadedMapId = () =>
  usePersistedState<string | null>("loadedMapId", {
    encode: (value) => JSON.stringify(value),
    decode: (rawValue) => {
      if (typeof rawValue === "string") {
        try {
          const parsedValue = JSON.parse(rawValue);
          if (typeof parsedValue === "string") {
            return parsedValue;
          }
          // eslint-disable-next-line no-empty
        } catch (e) {}
      }

      return null;
    },
  });

const useDmPassword = () =>
  usePersistedState<string>("dmPassword", {
    encode: (value) => JSON.stringify(value),
    decode: (value) => {
      try {
        if (typeof value === "string") {
          const parsedValue = JSON.parse(value);
          if (typeof parsedValue === "string") {
            return parsedValue;
          }
        }
        // eslint-disable-next-line no-empty
      } catch (e) {}
      return "";
    },
  });

type Mode =
  | {
      title: "LOADING";
      data: null;
    }
  | {
      title: "SHOW_MAP_LIBRARY";
    }
  | {
      title: "EDIT_MAP";
    }
  | {
      title: "MEDIA_LIBRARY";
    };

const createInitialMode = (): Mode => ({
  title: "LOADING",
  data: null,
});

type MapData = {
  currentMapId: null | string;
  maps: Array<MapEntity>;
};

type SocketTokenEvent =
  | {
      type: "add";
      data: {
        token: MapTokenEntity;
      };
    }
  | {
      type: "update";
      data: {
        token: MapTokenEntity;
      };
    }
  | {
      type: "remove";
      data: {
        tokenId: string;
      };
    };

type TokenPartial = Omit<Partial<MapTokenEntity>, "id">;

const Content = ({
  socket,
  password: dmPassword,
}: {
  socket: Socket;
  password: string;
}): React.ReactElement => {
  const [data, setData] = React.useState<null | MapData>(null);
  const [loadedMapId, setLoadedMapId] = useLoadedMapId();
  const loadedMapIdRef = React.useRef(loadedMapId);
  const [liveMapId, setLiveMapId] = React.useState<null | string>(null);
  // EDIT_MAP, SHOW_MAP_LIBRARY
  const [mode, setMode] = React.useState<Mode>(createInitialMode);

  const loadedMap = React.useMemo(
    () =>
      data ? data.maps.find((map) => map.id === loadedMapId) || null : null,
    [data, loadedMapId]
  );

  const localFetch = React.useCallback(
    (input, init = {}) => {
      return fetch(buildApiUrl(input), {
        ...init,
        headers: {
          Authorization: dmPassword ? `Bearer ${dmPassword}` : undefined,
          ...init.headers,
        },
      }).then((res) => {
        if (res.status === 401) {
          console.error("Unauthenticated access.");
          throw new Error("Unauthenticated access.");
        }
        return res;
      });
    },
    [dmPassword]
  );

  // load initial state
  useAsyncEffect(
    function* (_, c) {
      const { data }: { data: MapData } = yield* c(
        localFetch("/map").then((res) => res.json())
      );
      setData(data);
      const isLoadedMapAvailable = Boolean(
        data.maps.find((map) => map.id === loadedMapIdRef.current)
      );

      const isLiveMapAvailable = Boolean(
        data.maps.find((map) => map.id === data.currentMapId)
      );

      if (!isLiveMapAvailable && !isLoadedMapAvailable) {
        setMode({ title: "SHOW_MAP_LIBRARY" });
        setLoadedMapId(null);
        return;
      }

      setLiveMapId(isLiveMapAvailable ? data.currentMapId : null);
      setLoadedMapId(
        isLoadedMapAvailable ? loadedMapIdRef.current : data.currentMapId
      );
      setMode({ title: "EDIT_MAP" });
    },
    [setLoadedMapId, localFetch, dmPassword, socket]
  );

  // token add/remove/update event handlers
  React.useEffect(() => {
    if (!loadedMapId) return;
    const eventName = `token:mapId:${loadedMapId}`;
    socket.on(eventName, (ev: SocketTokenEvent) => {
      if (ev.type === "add") {
        const data = ev.data;
        setData(
          produce((appData: MapData | null) => {
            if (appData) {
              const map = appData.maps.find((map) => map.id === loadedMapId);
              if (map) {
                map.tokens.push(data.token);
              }
            }
          })
        );
      } else if (ev.type === "update") {
        const data = ev.data;
        setData(
          produce((appData: null | MapData) => {
            if (appData) {
              const map = appData.maps.find((map) => map.id === loadedMapId);
              if (map) {
                map.tokens = map.tokens.map((token) => {
                  if (token.id !== data.token.id) return token;
                  return {
                    ...token,
                    ...data.token,
                  };
                });
              }
            }
          })
        );
      } else if (ev.type === "remove") {
        const data = ev.data;
        setData(
          produce((appData: null | MapData) => {
            if (appData) {
              const map = appData.maps.find((map) => map.id === loadedMapId);
              if (map) {
                map.tokens = map.tokens.filter(
                  (token) => token.id !== data.tokenId
                );
              }
            }
          })
        );
      }
    });

    return () => {
      socket.off(eventName);
    };
  }, [socket, loadedMapId, setData]);

  const createMap = React.useCallback(
    async ({ file, title }) => {
      const formData = new FormData();

      formData.append("file", file);
      formData.append("title", title);

      const response = await localFetch(`/map`, {
        method: "POST",
        body: formData,
      }).then((res) => res.json());
      setData((data) =>
        data
          ? {
              ...data,
              maps: [...data.maps, response.data.map],
            }
          : data
      );
    },
    [localFetch]
  );

  const updateMap = React.useCallback(
    async (mapId, data) => {
      const res = await localFetch(`/map/${mapId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      }).then((res) => res.json());

      if (!res.data.map) {
        return;
      }

      setData(
        produce((data: null | MapData) => {
          if (data) {
            data.maps = data.maps.map((map) => {
              if (map.id !== res.data.map.id) {
                return map;
              } else {
                return { ...map, ...res.data.map };
              }
            });
          }
        })
      );
    },
    [localFetch]
  );

  const deleteMap = React.useCallback(
    async (mapId) => {
      await localFetch(`/map/${mapId}`, {
        method: "DELETE",
      });
      setData((data) =>
        data
          ? {
              ...data,
              maps: data.maps.filter((map) => map.id !== mapId),
            }
          : null
      );
    },
    [localFetch]
  );

  const addToken = React.useCallback(
    (token: { x: number; y: number; color: string; radius: number }) => {
      localFetch(`/map/${loadedMapId}/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...token,
        }),
      });
    },
    [loadedMapId, localFetch]
  );

  const deleteToken = React.useCallback(
    (tokenId) => {
      localFetch(`/map/${loadedMapId}/token/${tokenId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
    [loadedMapId, localFetch]
  );

  const persistTokenChanges = useStaticRef(() =>
    debounce((loadedMapId, id, updates, localFetch) => {
      localFetch(`/map/${loadedMapId}/token/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...updates,
        }),
      });
    }, 100)
  );

  const updateToken = React.useCallback(
    (id: string, updates: TokenPartial) => {
      setData(
        produce((data: null | MapData) => {
          if (data) {
            const map = data.maps.find((map) => map.id === loadedMapId);
            if (map) {
              map.tokens = map.tokens.map((token) => {
                if (token.id !== id) return token;
                return { ...token, ...updates };
              });
            }
          }
        })
      );

      persistTokenChanges(loadedMapId, id, updates, localFetch);
    },
    [loadedMapId, persistTokenChanges, localFetch]
  );

  const dmPasswordRef = React.useRef(dmPassword);

  React.useEffect(() => {
    dmPasswordRef.current = dmPassword;
  });

  const sendLiveMapTaskRef = React.useRef<null | ISendRequestTask>(null);
  const sendLiveMap = React.useCallback(
    async (canvas: HTMLCanvasElement) => {
      const loadedMapId = loadedMap?.id;

      if (!loadedMapId) {
        return;
      }

      if (sendLiveMapTaskRef.current) {
        sendLiveMapTaskRef.current.abort();
      }
      const blob = await new Promise<Blob>((res) => {
        canvas.toBlob((blob) => {
          res(blob!);
        });
      });

      const image = new File([blob], "fog.live.png", {
        type: "image/png",
      });

      const formData = new FormData();
      formData.append("image", image);

      const task = sendRequest({
        url: buildApiUrl(`/map/${loadedMapId}/send`),
        method: "POST",
        body: formData,
        headers: {
          Authorization: dmPassword ? `Bearer ${dmPassword}` : null,
        },
      });
      sendLiveMapTaskRef.current = task;
      const result = await task.done;
      if (result.type !== "success") {
        return;
      }
      setLiveMapId(loadedMapId);
    },
    [loadedMap?.id, dmPassword]
  );

  const sendProgressFogTaskRef = React.useRef<null | ISendRequestTask>(null);
  const saveFogProgress = React.useCallback(
    async (canvas: HTMLCanvasElement) => {
      const loadedMapId = loadedMap?.id;

      if (!loadedMapId) {
        return;
      }

      if (sendLiveMapTaskRef.current) {
        sendLiveMapTaskRef.current.abort();
      }
      const blob = await new Promise<Blob>((res) => {
        canvas.toBlob((blob) => {
          res(blob!);
        });
      });

      const formData = new FormData();

      formData.append(
        "image",
        new File([blob], "fog.png", {
          type: "image/png",
        })
      );

      const task = sendRequest({
        url: buildApiUrl(`/map/${loadedMapId}/fog`),
        method: "POST",
        body: formData,
        headers: {
          Authorization: dmPassword ? `Bearer ${dmPassword}` : null,
        },
      });
      sendProgressFogTaskRef.current = task;
      const result = await task.done;
      if (result.type !== "success") {
        return;
      }
      setLiveMapId(loadedMapId);
    },
    [loadedMap?.id, dmPassword]
  );

  const hideMap = React.useCallback(async () => {
    await localFetch("/active-map", {
      method: "POST",
      body: JSON.stringify({
        mapId: null,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });
    setLiveMapId(null);
  }, [localFetch]);

  const showMapModal = React.useCallback(() => {
    setMode({ title: "SHOW_MAP_LIBRARY" });
  }, []);

  const [droppedFile, setDroppedFile] = React.useState<null | File>(null);
  const i = React.useRef(1);
  const [dropZoneEventHandler] = useDropZone((params) => {
    const [file] = params.files;

    if (file.type.match(/image\/svg/) || file.type.match(/image\/webp/)) {
      const context = controlRef.current?.getContext();

      if (context) {
        const coords = context.helper.coordinates.screenToImage([
          params.position.x,
          params.position.y,
        ]);

        console.log(coords);

        setData(
          produce((appData: null | MapData) => {
            if (appData) {
              const map = appData.maps.find((map) => map.id === loadedMapId)!;
              map.tokens.push({
                id: String(i.current++),
                radius: 100,
                color: "red",
                x: coords[0],
                y: coords[1],
                isVisibleForPlayers: false,
                isMovableByPlayers: false,
                isLocked: false,
                reference: null,
                attachment: file,
                label: "",
              });
            }
          })
        );

        return;
      }
    }
    setDroppedFile(file);
  });

  const [markedAreas, setMarkedAreas] = React.useState<MarkedAreaEntity[]>(
    () => []
  );

  const onMarkArea = ([x, y]: [number, number]) => {
    socket.emit("mark area", {
      x,
      y,
    });
  };

  React.useEffect(() => {
    socket.on(
      "mark area",
      async (data: { id: string; x: number; y: number }) => {
        if (window.document.visibilityState === "hidden") {
          return;
        }
        setMarkedAreas((markedAreas) => [
          ...markedAreas,
          {
            id: data.id,
            x: data.x,
            y: data.y,
          },
        ]);
      }
    );

    return () => {
      socket.off("mark area");
    };
  }, [socket]);

  const actions = useNoteWindowActions();
  const controlRef = React.useRef<MapControlInterface | null>(null);

  return (
    <FetchContext.Provider value={localFetch}>
      {data && mode.title === "SHOW_MAP_LIBRARY" ? (
        <SelectMapModal
          canClose={loadedMap !== null}
          maps={data.maps}
          loadedMapId={loadedMapId}
          liveMapId={liveMapId}
          closeModal={() => {
            setMode({ title: "EDIT_MAP" });
          }}
          setLoadedMapId={(loadedMapId) => {
            setMode({ title: "EDIT_MAP" });
            setLoadedMapId(loadedMapId);
          }}
          updateMap={updateMap}
          deleteMap={deleteMap}
          createMap={createMap}
          dmPassword={dmPassword}
        />
      ) : null}
      {mode.title === "MEDIA_LIBRARY" ? (
        <MediaLibrary
          onClose={() => {
            setMode({ title: "EDIT_MAP" });
          }}
        />
      ) : null}
      {loadedMap ? (
        <div
          style={{ display: "flex", height: "100vh" }}
          onDragEnter={dropZoneEventHandler.onDragEnter}
          onDragLeave={dropZoneEventHandler.onDragLeave}
          onDragOver={dropZoneEventHandler.onDragOver}
          onDrop={dropZoneEventHandler.onDrop}
        >
          <div
            style={{
              flex: 1,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <DmMap
              controlRef={controlRef}
              password={dmPassword}
              map={loadedMap}
              liveMapId={liveMapId}
              sendLiveMap={sendLiveMap}
              saveFogProgress={saveFogProgress}
              hideMap={hideMap}
              showMapModal={showMapModal}
              openNotes={() => {
                actions.showNoteInWindow(null, "note-editor", true);
              }}
              openMediaLibrary={() => {
                setMode({ title: "MEDIA_LIBRARY" });
              }}
              markedAreas={markedAreas}
              markArea={onMarkArea}
              removeMarkedArea={(id) => {
                setMarkedAreas((areas) =>
                  areas.filter((area) => area.id !== id)
                );
              }}
              addToken={addToken}
              updateToken={updateToken}
              deleteToken={deleteToken}
              updateMap={(map) => {
                updateMap(loadedMap.id, map);
              }}
            />
          </div>
        </div>
      ) : null}
      {droppedFile ? (
        <ImportFileModal
          file={droppedFile}
          close={() => setDroppedFile(null)}
          createMap={createMap}
        />
      ) : null}
    </FetchContext.Provider>
  );
};

const DmAreaRenderer = ({
  password,
}: {
  password: string;
}): React.ReactElement => {
  const socket = useSocket();

  return (
    <AccessTokenProvider value={password}>
      <ToastProvider placement="bottom-right">
        <AuthenticatedAppShell
          socket={socket}
          password={password}
          isMapOnly={false}
          role="DM"
        >
          <Content socket={socket} password={password} />
        </AuthenticatedAppShell>
      </ToastProvider>
    </AccessTokenProvider>
  );
};

export const DmArea = () => {
  const [dmPassword, setDmPassword] = useDmPassword();
  // "authenticate" | "authenticated"
  const [mode, setMode] = React.useState("loading");

  const localFetch = React.useCallback(
    (input, init = {}) => {
      return fetch(buildApiUrl(input), {
        ...init,
        headers: {
          Authorization: dmPassword ? `Bearer ${dmPassword}` : undefined,
          ...init.headers,
        },
      }).then((res) => {
        if (res.status === 401) {
          console.error("Unauthenticated access.");
          throw new Error("Unauthenticated access.");
        }
        return res;
      });
    },
    [dmPassword]
  );

  useAsyncEffect(
    function* (_, c) {
      const result: { data: { role: string } } = yield* c(
        localFetch("/auth").then((res) => res.json())
      );
      if (!result.data.role || result.data.role !== "DM") {
        setMode("authenticate");
        return;
      }
      setMode("authenticated");
    },
    [localFetch]
  );

  if (mode === "loading") {
    return <SplashScreen text="Loading...." />;
  } else if (mode === "authenticate") {
    return (
      <AuthenticationScreen
        onAuthenticate={(password) => {
          setDmPassword(password);
          setMode("authenticated");
        }}
        fetch={localFetch}
        requiredRole="DM"
      />
    );
  } else if (mode === "authenticated") {
    return <DmAreaRenderer password={dmPassword} />;
  }
  return null;
};
