import * as React from "react";
import { Global } from "@emotion/react";
import { render } from "react-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { getUrlPrefix } from "./public-url";
import { globalStyles } from "./global-styles";
import { Modal } from "./modal";
import { registerSoundPlayback } from "./register-sound-playback";
import "react-colorful/dist/index.css";

const element = document.querySelector("#root");

// Listen to tab events to enable outlines (accessibility improvement)
document.body.addEventListener("keyup", (ev) => {
  /* tab */
  if (ev.keyCode === 9) {
    document.body.classList.remove("no-focus-outline");
  }
});

const pathname = window.location.pathname.replace(getUrlPrefix(), "");

const urlSearchParameter = new URLSearchParams(window.location.search);

const main = async () => {
  let component = null;
  switch (pathname) {
    case "/dm": {
      const { DmArea } = await import("./dm-area/dm-area");
      component = <DmArea />;
      break;
    }
    default: {
      const isMapOnly = urlSearchParameter.get("map_only") !== null;
      const password = urlSearchParameter.get("password");

      const { PlayerArea } = await import("./player-area");
      component = (
        <PlayerArea isMapOnly={isMapOnly} password={password || ""} />
      );
    }
  }
  if (element) {
    render(
      <ChakraProvider>
        <Modal.Provider>
          <Global styles={globalStyles}></Global>
          {component}
        </Modal.Provider>
      </ChakraProvider>,
      element
    );
  }
};

registerSoundPlayback();
main();
