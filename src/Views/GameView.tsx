import React from 'react';
import FactoryView from './FactoryView';
import IBaseProps from './IBaseProps';
import Factory from '../Game/Factory';

interface IGameState {
    selectedFactory: Factory;
}

export default class GameView extends React.Component<IBaseProps, IGameState> {

    constructor(props: Readonly<IBaseProps>) {
        super(props);
        // N’appelez pas `this.setState()` ici !
        this.state = { selectedFactory: this.props.game.factory };
    }

    changeFactory(factory: Factory) {
        this.setState({
            selectedFactory: factory
        });
    }

    goBack() {
        if (this.state.selectedFactory.topFactory)
            this.changeFactory(this.state.selectedFactory.topFactory);
    }

    render() {
        return (
            <div>
                <FactoryView
                    factory={this.state.selectedFactory}
                    onSelectedFactory={(factory) => this.changeFactory(factory)}
                    onGoBack={() => this.goBack()} />
            </div>
        );
    }
}